# Expo Mobile Application (pharmacy-mobile/)

This directory contains the React Native Expo mobile application.

## Scope & Responsibilities
- **Expo Framework**: Versioned docs at https://docs.expo.dev/versions/v56.0.0/ should be read before writing code.
- **Mobile Pages & Components**: Located in `app/` and `components/`.

## Development Rules
- Run `node scripts/quick-update.mjs` at the project root after adding or updating mobile components.
- **Interactive Chat Feeds**: Search result list items are rendered vertically inside chat bubbles, featuring manual quantity steppers (input and +/- buttons) and a dedicated "Add" button to populate the `BillingScreen` cart via the `lib/cartEvents.ts` event bus.

