import { onRequestGet as __ics_ts_onRequestGet } from 'D:\\codex-tmp\\Documents-ChatGPT\\Todo\\attention-planner\\functions\\ics.ts';

export const routes = [
  {
    routePath: '/ics',
    mountPath: '/',
    method: 'GET',
    middlewares: [],
    modules: [__ics_ts_onRequestGet],
  },
];
