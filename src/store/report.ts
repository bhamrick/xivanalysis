import {fflogsApi} from 'api'
import * as Errors from 'errors'
import {ReportFightsQuery, ReportFightsResponse} from 'fflogs'
import _ from 'lodash'
import {action, observable, runInAction} from 'mobx'
import {globalErrorStore} from 'store/globalError'

interface UnloadedReport {
	loading: true
}
export interface Report extends ReportFightsResponse {
	code: string
	loading: false
}
export type PossiblyLoadedReport = UnloadedReport | Report

export class ReportStore {
	@observable report?: PossiblyLoadedReport

	@action
	clearReport() {
		this.report = undefined
	}

	@action
	private async fetchReport(code: string, params?: ReportFightsQuery) {
		this.report = {loading: true}

		let response: ReportFightsResponse
		try {
			response = await fflogsApi.get(`report/fights/${code}`, {
				searchParams: {
					translate: 'true',
					..._.omitBy(params, _.isNil),
				},
			}).json<ReportFightsResponse>()
		} catch (e) {
			// Something's gone wrong, clear report status then dispatch an error
			runInAction(() => {
				this.report = undefined
			})

			// TODO: Probably need more handling than this...
			if (e.response && e.response.data.error === 'This report does not exist or is private.') {
				globalErrorStore.setGlobalError(new Errors.ReportNotFoundError())
			} else {
				globalErrorStore.setGlobalError(new Errors.UnknownApiError())
			}
			return
		}

		// Save out the report
		runInAction(() => {
			this.report = {
				...response,
				code,
				loading: false,
			}
		})
	}

	fetchReportIfNeeded(code: string) {
		if (this.report && (this.report.loading || code === this.report.code)) { return }
		this.fetchReport(code)
	}

	refreshReport() {
		if (!this.report || this.report.loading) { return }
		this.fetchReport(this.report.code, {bypassCache: true})
	}
}

export const reportStore = new ReportStore()
