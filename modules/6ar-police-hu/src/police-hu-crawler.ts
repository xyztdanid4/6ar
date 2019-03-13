import axios from 'axios';
import { noop } from 'lodash';
import { COUNTRIES, Country, CrossingInfo, extractCrossingInformation, infoUrlForCountry } from './police-hu';

export type Crossings = {
  [K in Country]: CrossingInfo[];
};

const EMPTY_CROSSINGS: Readonly<Crossings> = Object.freeze({
  Ukraine: [],
  Romania: [],
  Serbia: [],
  Croatia: [],
  Austria: []
});

function fetchTrafficContent(country: Country): Promise<[Country, CrossingInfo[]]> {
  const url = infoUrlForCountry(country);
  const DEFAULT_REQUEST_TIMEOUT = 10000;
  const infoQuery = axios.get(url, { timeout: DEFAULT_REQUEST_TIMEOUT });
  return infoQuery.then(
    (response): [Country, CrossingInfo[]] => [country, extractCrossingInformation(response.data)]
  );
}

export async function fetchCrossingInformation(): Promise<Crossings> {
  const infos = await Promise.all(COUNTRIES.map(fetchTrafficContent));

  return infos.reduce((acc, [country, crossingInfo]) => ({
    ...acc,
    [country]: crossingInfo
  }), EMPTY_CROSSINGS);
}

export interface FetchTaskOptions {
  // Specifies how frequently is the fetch task repeated
  interval: number;
  // Number of retries before the task gives up. After a successful query, the counter resets to the given base value
  retries: number;
  // Called in case there is an error during the fetch task (meaning when a retry is triggered),
  // with the error and the number of retries remaining
  errorHandler: (err: Error, retriesLeft: number) => void;
}

// Result of the function determines whether to continue the task or not.
export type FetchTaskHandler = (data: Crossings) => Promise<boolean>;

// Start a background task for regurarly fetching the border traffic information.
// The background task can bpe terminated through the 'crossingHandler' return value (falsy value stops the task)
// or by calling the 'stopFetchTask' on the resolved return value of the function.
export function startFetchTask(crossingHandler: FetchTaskHandler, options?: Partial<FetchTaskOptions>): number {
  const DEFAULT_FETCH_TASK_OPTIONS: Readonly<FetchTaskOptions> = Object.freeze({
    interval: 1000 * 60 * 10, // every 10 minutes
    retries: 3,
    errorHandler: noop
  });

  const { interval, retries, errorHandler } = { ...DEFAULT_FETCH_TASK_OPTIONS, ...options };

  let retiresLeft = retries;
  let fetchTaskId: number;

  async function fetchTask(retriesLeft: number) {
    try {
      const crossingInfo = await fetchCrossingInformation();
      const doContinueTask = await crossingHandler(crossingInfo);
      if (!doContinueTask) {
        stopFetchTask(fetchTaskId);
      }
      // in case of a successful fetch query, we reset the number of retries
      retiresLeft = retries;
    } catch (err) {
      retriesLeft = retriesLeft - 1;
      errorHandler(err, retriesLeft);

      // if we exceeded the retry threshold, we do the termination immediatelly,
      // otherwise it would only happen after the given interval.
      if (retiresLeft <= 0) {
        stopFetchTask(fetchTaskId);
      }
    }
  }

  // setInterval is used instead of async setTimeout recursion in 'fetchTask' to have a single
  // timer id, which can be returned to the caller.
  // Thus we don't have to keep track of which setTimeout id to terminate it this module.
  fetchTaskId = setInterval(fetchTask, interval);
  return fetchTaskId;
}

export function stopFetchTask(taskId: number) {
  clearInterval(taskId);
}