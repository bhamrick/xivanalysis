import {t} from '@lingui/macro'
import {Trans} from '@lingui/react'
import {BASE_GCD} from 'data/CONSTANTS'
import {Analyser} from 'parser/core/Analyser'
import {Actors} from 'parser/core/modules/Actors'
import {Events} from 'event'
import {dependency} from 'parser/core/Injectable'
import {Data} from 'parser/core/modules/Data'
import {SpeedAdjustments} from 'parser/core/modules/SpeedAdjustments'
import {SimpleStatistic, Statistics} from 'parser/core/modules/Statistics'

// Data for a single cast
interface CastTiming {
    actionId?: number,
    prepareTime?: number,
    castTime?: number,
    nextActionTime?: number,
    inLeylines?: boolean,
}

interface SpsEvaluation {
    casterTax: number,
    queuedCount: number,
    leftoverMean: number,
}

interface TimingInfo {
    spellSpeed: number,
    casterTax: number,
}

const MAX_QUEUE_VARIANCE = 150

export class CasterTax extends Analyser {
    static override handle = 'CasterTax'
    static override title = t('blm.caster-tax.title')`Caster Tax`

    @dependency private data!: Data
	@dependency private actors!: Actors
    @dependency private statistics!: Statistics
    @dependency private speedAdjustments!: SpeedAdjustments

    private currentCast: CastTiming = {}
    private casts: CastTiming[] = []
    private timing?: TimingInfo

    override initialise() {
        this.addEventHook({type: 'prepare', source: this.parser.actor.id}, this.onPrepare)
        this.addEventHook({type: 'interrupt', source: this.parser.actor.id}, this.onInterrupt)
        this.addEventHook({type: 'action', source: this.parser.actor.id}, this.onCast)
        this.addEventHook('complete', this.onComplete)
    }

    private castDuration(speedStat: number, baseDuration: number, leylines: boolean): number {
        const multiplier = leylines ? 85 : 100;
        // TODO: Use constants for these magic numbers
        const statReduction = Math.floor(130 * (speedStat - 400) / 1900)/1000
        const adjustedDurationSeconds = Math.floor(baseDuration * (1 - statReduction)) / 1000
        // Multiply by multiplier / 100 to get the result in seconds, then
        // multiply by 1000 to convert to milliseconds.
        return Math.floor(multiplier * adjustedDurationSeconds) * 10
    }

    private onPrepare(event: Events['prepare']) {
        const actionId = event.action
		const action = this.data.getAction(actionId)
        const timestamp = event.timestamp
        if (!action.onGcd) {
            return
        }

        if (this.currentCast) {
            this.currentCast.nextActionTime = timestamp
            this.casts.push(this.currentCast)
            this.currentCast = {}
        }
        this.currentCast.prepareTime = timestamp
        this.currentCast.inLeylines = this.actors.current.hasStatus(this.data.statuses.CIRCLE_OF_POWER.id)
    }

    private onInterrupt(event: Events['interrupt']) {
        const actionId = event.action
		const action = this.data.getAction(actionId)
        const timestamp = event.timestamp
        if (!action.onGcd) {
            return
        }
        this.currentCast = {}
    }

    private onCast(event: Events['action']) {
        const actionId = event.action
		const action = this.data.getAction(actionId)
        const timestamp = event.timestamp

		if (!action || action.autoAttack || !action.onGcd) {
			return
		}

        if (this.currentCast && this.currentCast.castTime) {
            this.currentCast.nextActionTime = timestamp
            this.casts.push(this.currentCast)
            this.currentCast = {}
        }
        this.currentCast.castTime = timestamp
        this.currentCast.actionId = actionId
        if (!this.currentCast.prepareTime) {
            this.currentCast.prepareTime = timestamp
            this.currentCast.inLeylines = this.actors.current.hasStatus(this.data.statuses.CIRCLE_OF_POWER.id)
        }
    }

    private hasCasterTax(cast: CastTiming): boolean {
        let action = this.data.getAction(cast.actionId)
        return cast.castTime != cast.prepareTime && action.castTime >= BASE_GCD
    }

    private evaluateSps(speedStat: number): SpsEvaluation {
        var leftovers: number[] = []
        var casterTaxLeftovers: number[] = []
        var minLeftover = 1000000
        var minCasterTaxLeftover = 1000000
        for (const cast of this.casts) {
            let action = this.data.getAction(cast.actionId)
            let hasCasterTax = this.hasCasterTax(cast)
            let baseCastTime = hasCasterTax ? action.castTime : BASE_GCD
            let expectedDuration = this.castDuration(speedStat, baseCastTime, cast.inLeylines)
            let leftover = cast.nextActionTime - cast.prepareTime - expectedDuration
            if (hasCasterTax) {
                casterTaxLeftovers.push(leftover)
                // Ignore some casts where they are expected to have caster
                // tax but actually come out shorter than expected duration.
                // Possibly catching the end of a LeyLines buff but we don't
                // realize?
                if (leftover < minCasterTaxLeftover && leftover > 0) {
                    minCasterTaxLeftover = leftover
                }
            } else {
                leftovers.push(leftover)
                if (leftover < minLeftover) {
                    minLeftover = leftover
                }
            }
        }
        leftovers = leftovers.filter(x => x <= minLeftover + MAX_QUEUE_VARIANCE)
        casterTaxLeftovers = casterTaxLeftovers.filter(x => x <= minCasterTaxLeftover + MAX_QUEUE_VARIANCE && x >= 0)
        let leftoverMean = leftovers.reduce((a, b) => a+b) / leftovers.length
        let casterTax = casterTaxLeftovers.reduce((a, b) => a+b) / casterTaxLeftovers.length
        return {
            casterTax: casterTax,
            queuedCount: leftovers.length + casterTaxLeftovers.length,
            leftoverMean: leftoverMean,
        }
    }

    private minSps(cast: CastTiming): number {
        let action = this.data.getAction(cast.actionId)
        let baseCastTime = (action.castTime < BASE_GCD || cast.castTime == cast.prepareTime) ? BASE_GCD : action.castTime
        var lo = 400
        var hi = 3000
        while (lo < hi) {
            let mid = Math.floor((lo + hi) / 2)
            if (this.castDuration(mid, baseCastTime, cast.inLeylines) < cast.nextActionTime - cast.prepareTime) {
                hi = mid
            } else {
                lo = mid + 1
            }
        }
        return lo
    }

    private onComplete() {
        // For now ignore all F3/B3 casts since the halved cast time is annoying to account for.
        this.casts = this.casts.filter(cast => cast.actionId != this.data.actions.FIRE_III.id && cast.actionId != this.data.actions.BLIZZARD_III.id)
        var sps: number
        var evaluation: SpsEvaluation
        for (sps = 400; sps < 3000; sps += 10) {
            evaluation = this.evaluateSps(sps)
            if (evaluation.leftoverMean > 0) {
                break
            }
        }
        this.timingInfo = {
            spellSpeed: sps,
            casterTax: evaluation.casterTax,
        }
        this.statistics.add(new SimpleStatistic({
            title: <Trans id="jobs.blm.caster-tax">Estimated Caster Tax</Trans>,
            value: this.parser.formatDuration(evaluation.casterTax, 3),
        }))
        this.statistics.add(new SimpleStatistic({
            title: <Trans id="jobs.blm.caster-tax-sps">Estimated Spell Speed</Trans>,
            value: sps,
        }))
    }

    public getTiming(): TimingInfo {
        return this.timingInfo
    }
}
