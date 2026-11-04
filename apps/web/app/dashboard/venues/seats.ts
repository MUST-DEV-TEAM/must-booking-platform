/** "4 seats" for a fixed table, "2 to 4 seats" for one that takes a range of party sizes. */
export function seatsText(minSeats: number, maxSeats: number): string {
  if (minSeats === maxSeats) return `${maxSeats} seat${maxSeats === 1 ? '' : 's'}`;
  return `${minSeats} to ${maxSeats} seats`;
}
