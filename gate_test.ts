import { isMedicineLikely } from './src/services/intentKeywords.js';

const cases: Array<[string, string, string, boolean]> = [
  ['booking screenshot (Cancellat)', 'Invoice No INV123 Date 07/07/2026 Train PNR 223344 Booking Journey Passenger Fare Sleeper Class Cancellat Status', 'CANCELLED ITEM', false],
  ['NEVANAC eye drops', 'Nevanac Nepafenac Ophthalmic Suspension 0.1% w/v 5ml Alcon', 'Nevanac', true],
  ['plain medicine strip', 'Augmentin 625 Duo Tablet Amoxycillin Clavulanic Acid 10 tablets', 'Augmentin 625', true],
  ['food packet', 'Good Day Biscuits 250g Butter Flavour', 'Good Day', true],
  ['pure chatter photo', 'Happy Birthday!', 'Happy Birthday', false],
];

let pass = 0;
for (const [label, text, name, expected] of cases) {
  const got = isMedicineLikely(text, name);
  const ok = got === expected;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | expected=${expected} got=${got} | ${label}`);
}
console.log(`\n${pass}/${cases.length} passed`);
