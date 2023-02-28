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

import {Gauge} from './Gauge'

export class PotencyPerSecond extends Analyser {
    static override handle = 'pps'
    static override title = t('blm.pps.title')`Potency Per Second`

    @dependency private statistics!: Statistics
    @dependency private data!: Data
    @dependency private gauge!: Gauge
    @dependency private actors!: Actors
}
