/** First name only — enough for audit lines and keeps screens short. */
export const firstName = (name: string | null | undefined) => (name ?? '').split(' ')[0] || 'okänd';
