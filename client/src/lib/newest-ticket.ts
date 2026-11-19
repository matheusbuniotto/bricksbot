/**
 * Tickets for overlapping async loads: call the returned function before fetching, and apply the result
 * only if the ticket it gave you is still the newest, so a slow older response cannot overwrite a newer one.
 */
export function newestTicket() {
  let latest = 0;
  return () => {
    const mine = ++latest;
    return () => mine === latest;
  };
}
