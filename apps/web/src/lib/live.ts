/** The admin pages' live channel: the server's `depends()` key and the SSE address must match. */
export const liveKey = (slug: string) => `live:${slug}`;
export const liveEventsUrl = (slug: string) => `/api/v1/live/${slug}/events`;
