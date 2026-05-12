# Aperçus — convention par slug

Le JS découvre automatiquement les assets via leur nom de fichier. Dépose un fichier à l'emplacement attendu et rafraîchis la page : aucune édition HTML/JS nécessaire.

## Structure

```
assets/previews/<slug>/<role>.<ext>
```

**Slug** = identifiant du projet ou de la catégorie (voir tableau).
**Role** = ce que représente l'asset (voir tableau).
**Extensions reconnues**, dans l'ordre de priorité : `mp4`, `webm`, `gif`, `svg`, `png`, `jpg`, `jpeg`, `webp`.

Si deux extensions cohabitent pour le même rôle, la première de la liste gagne. Les `.json` Lottie restent supportés via `data-preview-src` explicite uniquement.

## Slugs disponibles

### Projets (cartes sur `work.html`, pages case study)

| Slug                  | Projet                       |
| --------------------- | ---------------------------- |
| `autoya-mobile`       | Autoya — Mobile              |
| `autoya-webapp`       | Autoya — Webapp              |
| `merim-design-system` | Merim · Design system        |
| `merim-caisse`        | Merim · Module Caisse        |
| `merim-reporting`     | Merim · Module Reporting     |
| `merim-drive-thru`    | Merim · Module Drive-thru    |
| `eximion`             | Eximion                      |
| `restoapp`            | Restoapp                     |
| `tdc-vendredi`        | TDC · Vendredi               |
| `tdc-heetch`          | TDC · Heetch                 |
| `tdc-passculture`     | TDC · Pass Culture           |
| `tie-break`           | Tie Break                    |

### Catégories (hover sur l'accueil)

| Slug            | Catégorie       |
| --------------- | --------------- |
| `tns`           | Autoya — TNS    |
| `restoapp`      | RestoApp        |
| `merim`         | Merim Groupe    |
| `tdc`           | The Design Crew |
| `eximion`       | Eximion         |
| `frenchproduit` | FrenchProduit   |

Les slugs `eximion` et `restoapp` sont partagés entre projet et catégorie : `tile.<ext>` sert pour la carte work.html, `home.<ext>` sert pour le hover accueil.

## Rôles

| Role         | Affiché où                                                                       |
| ------------ | -------------------------------------------------------------------------------- |
| `tile`       | Vignette permanente sur `work.html`                                              |
| `home`       | Aperçu au hover sur l'accueil (fallback sur `tile` si absent)                    |
| `stage-01`   | Stage du case study, position 1                                                  |
| `stage-02`   | Stage du case study, position 2                                                  |
| `stage-03`   | Stage du case study, position 3                                                  |
| `stage-04`   | Stage du case study, position 4                                                  |
| `thumb-NN`   | Frame statique de la vignette N du case study (fallback sur `stage-NN` si absent) |

## Exemples

```
previews/tdc-heetch/tile.mp4         → vignette Heetch sur work.html
previews/tdc-heetch/stage-01.mp4     → premier stage du case study Heetch
previews/tie-break/stage-01.gif      → premier stage du case study Tie Break
previews/tie-break/thumb-01.jpg      → frame statique de la vignette 01 (sinon le gif anime aussi le thumb)
previews/tns/home.json               → Lottie au hover de « Autoya — TNS » sur l'accueil (via data-preview-src)
previews/eximion/home.png            → hover accueil ET fallback tile (si pas de tile.* explicite)
```

## Format recommandé

- **MP4** H.264 muet, 640×480 ou 720×540, 3–6 s en boucle, < 1 MB.
- **WebM** VP9 mêmes dimensions, plus compact.
- **GIF** < 500 KB idéalement, couleurs réduites.
- **SVG** vectoriel, idéal pour logos/illustrations statiques.
- **PNG/JPG/WebP** 640×480 minimum.

## Comportement

- Vidéos : autoplay muet + loop + playsInline (géré par le JS).
- Le JS fait un `HEAD` par extension pour résoudre l'asset. Résultat caché dans `sessionStorage` (`pv:<slug>/<role>`).
- Si aucun fichier n'existe pour le slug/role, le fallback (dégradé + initiales) reste visible.
- Désactivé sur mobile et si `prefers-reduced-motion` est actif (pour les hovers).

## Compresser rapidement

Avec `ffmpeg` (Homebrew : `brew install ffmpeg`) :

```bash
# MP4 H.264 compact
ffmpeg -i source.mov -vf "scale=720:-2" -c:v libx264 -crf 28 -preset slow -an tile.mp4

# WebM VP9 plus compact
ffmpeg -i source.mov -vf "scale=720:-2" -c:v libvpx-vp9 -crf 35 -b:v 0 -an tile.webm
```
