export const formatDate = (
    value: string | Date | undefined | null,
    locale: string = 'es-PE',
    options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string => {
    if (!value) return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (isNaN(date.getTime())) return '—';
    try {
        return new Intl.DateTimeFormat(locale, options).format(date);
    } catch {
        return date.toLocaleString(locale);
    }
};
