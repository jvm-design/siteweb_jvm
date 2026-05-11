# Aperçus au hover

Dépose ici les vidéos, gifs ou images qui s'affichent dans la vignette quand tu survoles un projet.

## Nom attendu (par projet)

Le JS lit l'attribut `data-preview-src` des items. Les valeurs par défaut pointent vers ce dossier :

| Projet          | Chemin attendu                     |
| --------------- | ---------------------------------- |
| Autoya          | `assets/previews/autoya.mp4`       |
| Merim Groupe    | `assets/previews/merim.mp4`        |
| The Design Crew | `assets/previews/design-crew.mp4`  |
| Eximion         | `assets/previews/eximion.mp4`      |
| FrenchProduit   | `assets/previews/frenchproduit.mp4`|
| Rugby WC 2023   | `assets/previews/france-2023.mp4`  |

Tu peux remplacer `.mp4` par `.webm`, `.gif`, `.png`, `.jpg` ou `.webp` — change juste l'attribut `data-preview-src` dans le HTML.

## Format recommandé

- **Vidéo MP4** : codec H.264, muet, 640×480 ou 720×540, 3–6 s en boucle, < 1 MB.
- **Vidéo WebM** : codec VP9, mêmes dimensions, plus compact que MP4.
- **GIF** : < 500 KB idéalement, couleurs réduites.
- **PNG/JPG/WebP** : 640×480 minimum.

## Comportement

- Autoplay muet + loop + playsInline (géré par le JS).
- Fade-in 0.3 s quand la vidéo/image est chargée.
- Si le fichier n'existe pas ou échoue → fallback sur le dégradé + label du projet.
- Désactivé sur mobile et si `prefers-reduced-motion` est actif.

## Compresser rapidement

Avec `ffmpeg` (Homebrew : `brew install ffmpeg`) :

```bash
# MP4 H.264 compact
ffmpeg -i source.mov -vf "scale=720:-2" -c:v libx264 -crf 28 -preset slow -an autoya.mp4

# WebM VP9 plus compact
ffmpeg -i source.mov -vf "scale=720:-2" -c:v libvpx-vp9 -crf 35 -b:v 0 -an autoya.webm
```
