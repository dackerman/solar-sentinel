# Passenger cars

Source: user supplied `~/Downloads/generic-passenger-car-pack.zip` on October 6, 2026.
The archive contains `source/fab.fbx` and separate textures, without an accompanying
attribution/license document. Preserve the source archive for provenance.

Selected models:

| Output | FBX body | Wheels | Body texture | Wheel texture |
| --- | --- | --- | --- | --- |
| compact.glb | Compact_Body | Four nearest wheel meshes | CompactBlue.png | wheel_C_Diffuse.png |
| sedan.glb | Sedan_Body | Four nearest wheel meshes | SedanYellow.png | Wheel_A_Diffuse.png |

Both use `lights.jpg` for the Optics material. GLBs retain material names and FBX UVs;
textures load separately with `flipY=true`. Geometry is baked into Y-up, Z-long street
coordinates, centered in X/Z, with tire bottoms at Y=0. Compact length is 3.8 and sedan
length is 4.5. Glass uses dark opaque material to avoid transparent-shell sorting.

Regenerate geometry after unzipping:

```sh
node scripts/convert-car-pack.mjs /tmp/solar-car-pack/source/fab.fbx
```

Texture conversion used macOS `sips`, maximum dimension 512, JPEG quality 85:

```sh
sips -Z 512 -s format jpeg -s formatOptions 85 /tmp/solar-car-pack/textures/CompactBlue.png --out src/scene/assets/cars/compact.jpg
sips -Z 512 -s format jpeg -s formatOptions 85 /tmp/solar-car-pack/textures/SedanYellow.png --out src/scene/assets/cars/sedan.jpg
sips -Z 512 -s format jpeg -s formatOptions 85 /tmp/solar-car-pack/textures/wheel_C_Diffuse.png --out src/scene/assets/cars/compact-wheel.jpg
sips -Z 512 -s format jpeg -s formatOptions 85 /tmp/solar-car-pack/textures/Wheel_A_Diffuse.png --out src/scene/assets/cars/sedan-wheel.jpg
sips -Z 512 -s format jpeg -s formatOptions 85 /tmp/solar-car-pack/textures/lights.jpg --out src/scene/assets/cars/lights.jpg
```
