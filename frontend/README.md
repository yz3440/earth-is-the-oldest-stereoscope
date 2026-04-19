# stereo-moon frontend

Vite + Preact + Three.js viewer for the Boston/Santiago stereo-moon footage.

```sh
bun install
bun run dev
```

## Texture credits

The 3D scene uses the following texture maps, redistributed under their
respective licenses in [`public/textures/`](public/textures):

### Earth — `earth_daymap_2k.jpg`, `earth_nightmap_2k.jpg`

Solar System Scope — *Solar Textures*.
<https://www.solarsystemscope.com/textures/>
Licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

### Moon — `moon_color_2k.jpg`, `moon_displacement_2k.jpg`

NASA's Scientific Visualization Studio — *CGI Moon Kit*. Color and
displacement maps are derived from data assembled by the Lunar
Reconnaissance Orbiter Camera (LROC) and Lunar Orbiter Laser Altimeter
(LOLA) instrument teams.
<https://svs.gsfc.nasa.gov/4720>
The files shipped here are downsampled to 2048×1024 from the native
27360×13680 (color) and full-resolution displacement source.
Credit: NASA's Scientific Visualization Studio.
