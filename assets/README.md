# Assets

trakarr's mark, shared by the landing page in `site/` and the dashboard in `app/`.

- `logo.svg`: the mark, a white magnet with red poles on a near-black disk. It's
  both pages' favicon and header mark. Its colours are fixed, so it looks the
  same in both themes.
- `logo.css`: the mark's animation, which plays every 10 s. It needs the SVG
  inline.
- `wordmark.css`: a `.wordmark` class that sets the name like the landing
  page's hero heading.

## The mark

A magnet: the torrent's own symbol, and what holds the downloads. In a 32 by 32
viewBox:

| Part   | Geometry                                                  | Colour    |
| ------ | --------------------------------------------------------- | --------- |
| Disk   | circle, r 16                                              | `#111111` |
| Magnet | legs at x 10 and 22 from y 7 to 16.5, arc r 6, stroke 5   | `#ffffff` |
| Poles  | the legs' top, y 7 to 11.5                                | `#f0443a` |
| Field  | six squiggles out of the poles, in two frames, stroke 0.8 | `#ffffff` |

The field is hidden until the animation plays; an `<img>` or a favicon never
shows it.

## The animation

Every 10 s, once the SVG is inline: the magnet is drawn upwards and sticks to
the rim. Pulled away, it stretches with its poles still stuck, tips to one side
until a pole lets go, then flies off spinning a full turn and settles back where
it was. While there's pull, the squiggles flicker out of the poles. The motion
takes 2 s, the rest of the cycle is still, and it's off under reduced motion.

## The wordmark

"trakarr", lowercase, in Inter at 700 with -0.035em of tracking: the same
setting as the landing page's hero heading. Both pages load Inter on their own,
the site from `site/inter.woff2` and the app from Fontsource, so `wordmark.css`
only names it; each header sets its own size.

## Using it

The site links `../assets/logo.svg` as its icon, `../assets/logo.css` and
`../assets/wordmark.css`, and puts an `<img class="logo" src="../assets/logo.svg">`
and a `<span class="wordmark">` in `<a class="brand">`; a script inlines the SVG
so the animation can reach its parts. The Pages workflow
copies `assets/` next to the page, so `../assets/` resolves there. To preview
the site locally, serve the repository's root, not `site/`:

```sh
python3 -m http.server 8765   # then open http://localhost:8765/site/
```

In the app, `src/components/Logo.tsx` imports the SVG's text,
`import mark from "../../../assets/logo.svg?raw"`, and sets it as a span's inner
HTML, with `import "../../../assets/logo.css"` for the animation;
`src/App.tsx` has `import "../../assets/wordmark.css"` for the name's span; and
the app's `index.html` links the file as the icon. Vite bundles all of it.
