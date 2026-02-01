# Reeflux Beta Landing Site

A static, MS-DOS-inspired landing site for Reeflux Beta with animated pixel pools, ambient audio, and a Netlify-ready requests terminal.

## Audio asset
Place the ambient MP3 at:

```
assets/reefux_ambient.mp3
```

The site loads this file via `<audio id="reefAudio" loop preload="auto">` and requires a user gesture to start playback.

## Stripe payment links
Update the Stripe Payment Link constants in `app.js`:

```js
const SALOON_PASS_URL = "https://buy.stripe.com/your_saloon_link";
const QUIET_ROOM_URL = "https://buy.stripe.com/your_quiet_link";
const MIRROR_SEAL_URL = "https://buy.stripe.com/your_mirror_link";
```

These URLs power the buttons on `/token-booth.html`.

## Netlify deployment
1. Push this repo to GitHub.
2. In Netlify, create a new site from Git and select the repo.
3. Set the build command to **none** and the publish directory to the repo root.
4. Deploy the site.
5. In Netlify **Domain settings**, add `reefux.com` and follow the instructions to point DNS (typically A records or a CNAME via Netlify DNS).

### Netlify Forms submissions
Form submissions are available in Netlify:

- Site dashboard → **Forms** → **reefux-requests**

## Autoplay restrictions
Most browsers block audio autoplay without a user gesture. The Play button is required to start audio, and the app will only attempt autoplay if the user previously set the state to “playing” in localStorage. If the browser blocks it, the UI remains paused.
