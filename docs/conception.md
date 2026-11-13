# Wirely — note de conception

Cette note explique **pour qui** l'outil est fait et **pourquoi** il est construit ainsi. Elle sert de
boussole : une fonction qui n'aide pas l'électricien décrit ici n'a pas sa place dans l'interface.

## 1. L'électricien, sa journée, ses trois métiers

Wirely s'adresse à un électricien (indépendant ou petite équipe), en Belgique ou en France, qui fait
du résidentiel. Il utilise l'outil **sur chantier** (téléphone ou tablette, une main, debout, parfois
dans une cave) puis **au bureau** (ordinateur, clavier, le soir).

### Relevé de l'existant

> Lundi 8 h 30, maison à vendre. Thomas est devant un tableau de 1990, quatorze disjoncteurs, aucune
> étiquette. Téléphone dans une main, testeur dans l'autre.

Il saisit le tableau **comme il le voit** : un différentiel, puis des disjoncteurs, calibre par
calibre. Ensuite il coupe un disjoncteur, fait le tour des pièces et note ce qui ne fonctionne plus.
Il ne dessine rien : **il compte**. « Circuit C : cuisine, quatre prises, un point lumineux. »

Ce qu'il lui faut : créer le chantier en dix secondes, ajouter un circuit d'un geste, garder un
circuit « en main » pendant qu'il marche, des compteurs par pièce, aucune saisie de texte obligatoire,
un enregistrement automatique qui fonctionne sans réseau.

### Étude et devis

> Mardi 17 h, visite chez un client pour une rénovation. Sarah fait le tour avec lui, tablette en main.

Pièce par pièce, elle note ce que le client veut : six prises ici, deux points lumineux, un
va-et-vient. Le client change d'avis trois fois. À la fin de la visite il veut **un ordre de prix**.

Ce qu'il lui faut : les mêmes compteurs, des repères de norme pour ne rien oublier, des circuits
proposés automatiquement, et un **devis au point** qui se met à jour à chaque geste.

### Dossier de contrôle

> Vendredi, fin de chantier. Le contrôleur passe lundi.

En Belgique, le RGIE impose un **schéma unifilaire** et un **schéma de position**, datés, signés,
avec l'adresse, en trois exemplaires. Chaque circuit porte une lettre (A, B, C…), chaque élément un
numéro d'ordre (A1, A2…), **identiques sur les deux schémas**. Un écart entre les deux est une
infraction. En France, l'électricien remet le schéma du tableau, le repérage des circuits et le plan
d'implantation.

Ce qu'il lui faut : que les deux schémas sortent **de la même saisie**, donc forcément cohérents ; une
liste de ce que le contrôleur va relever, avant qu'il le relève ; des étiquettes à l'échelle pour le
tableau ; ses coordonnées et celles du client saisies une seule fois.

## 2. Ce que cela change par rapport aux versions précédentes

| Avant | Maintenant |
| --- | --- |
| On commençait par dessiner un plan à l'échelle | On commence par **compter des points** ; le plan vient après et peut rester schématique |
| Le circuit était un détail d'un symbole | Le **circuit** (lettre, couleur) est partout : pièces, plan, tableau, schémas |
| Norme française uniquement | **Belgique (RGIE) ou France (NF C 15-100)**, au choix par chantier |
| Interface de bureau | **Chantier au pouce, bureau au clavier** : mêmes données, deux ergonomies |
| Une fiche d'export générique | Les **documents attendus** : unifilaire, position, repérage, étiquettes, devis, avec cartouche |
| Synthèse à lire | **Liste du contrôleur** : chaque remarque mène à l'endroit où la corriger |

## 3. Principes

1. **Compter d'abord, dessiner ensuite.** Un point existe dès qu'il est compté dans une pièce. Il est
   posé automatiquement sur le plan, marqué « position à vérifier », et on l'ajuste plus tard.
2. **Une saisie, deux schémas.** L'unifilaire et le schéma de position sont générés à partir des mêmes
   points et des mêmes circuits : ils ne peuvent pas se contredire.
3. **Le circuit en main.** Un « circuit actif » reste sélectionné tant qu'on ne le change pas ; tout ce
   qu'on ajoute s'y raccorde. Sa lettre et sa couleur sont visibles en permanence.
4. **Ne jamais ressaisir.** Client, adresse, installateur : une fois, puis sur chaque document.
5. **La liste de contrôle est le contrôleur.** Elle applique les règles du pays, dit ce qui manque et
   y conduit d'un geste.
6. **Sobre, fluide, lisible.** Peu de couleurs (celles des circuits), de gros boutons, des animations
   courtes qui confirment un geste, une progression toujours visible. Pas de jeu, pas de médailles.
7. **Tout s'annule.** Chaque action automatique affiche ce qu'elle a fait, avec « Annuler ».

## 4. Organisation de l'outil

Cinq espaces, dans l'ordre du travail. Barre du bas sur téléphone, barre latérale sur ordinateur.

| Espace | Question à laquelle il répond | Sur chantier | Au bureau |
| --- | --- | --- | --- |
| **Chantier** | Où en suis-je ? Que reste-t-il ? | Créer, renseigner le client | Suivre l'avancement, corriger les remarques |
| **Pièces** | Qu'y a-t-il dans chaque pièce ? | Compteurs au pouce | Renommer, répartir entre circuits |
| **Tableau** | Quels circuits, quelles protections ? | Ajouter un circuit d'un geste | Régler câbles et différentiels, face avant |
| **Plan** | Où est chaque point ? | Consulter | Ajuster les positions, portes, murs, 3D |
| **Dossier** | Que dois-je remettre ? | Montrer au client | Aperçu, impression, devis |

### Pièces

- Une pièce se crée en un geste (une puce par type : cuisine, séjour, chambre…).
- Dans une pièce : une grille de **compteurs** (prise, prise double, point lumineux, interrupteur,
  va-et-vient, appareils fixes…). « + » ajoute un point sur le circuit actif.
- Sous les compteurs, la liste des points avec leur repère (A3) et leur circuit, modifiable.

### Tableau

- **Circuits** (vue par défaut) : une liste groupée par différentiel. Une rangée de calibres
  (10 · 16 · 20 · 25 · 32 · 40 A) ajoute un circuit d'un geste. Chaque circuit montre sa charge
  (5 / 8 points) et ce qu'il alimente, pièce par pièce.
- **Face avant** : les rails DIN, pour l'implantation réelle et les modules de domotique.
- **Unifilaire** : le schéma généré, tel qu'il sera imprimé.

### Plan

- Les pièces créées depuis la liste sont posées côte à côte, en blocs. En Belgique le schéma de
  position n'a pas à être à l'échelle : un plan schématique suffit, tant que les positions relatives
  sont justes.
- Les points comptés sont déjà là, entourés d'un trait pointillé tant qu'ils n'ont pas été vérifiés.
  Les glisser les valide. Un compteur indique combien il en reste.

### Dossier

- Documents : schéma unifilaire, schéma de position, repérage des circuits, étiquettes du tableau à
  l'échelle (17,5 mm par module), devis au point, plus les fiches détaillées.
- Chaque document porte un cartouche (chantier, adresse, client, installateur, date, signature).

## 5. Règles appliquées

Toutes les règles sont des **repères** : elles aident à ne rien oublier, elles ne remplacent ni le
texte réglementaire ni l'organisme de contrôle. Elles sont regroupées par pays dans
`src/domain/rules/`.

### Belgique (RGIE, Livre 1)

- Au plus **8 points par circuit** comportant des prises. Un socle multiple dans un même ensemble
  compte pour un ; sur un circuit mixte, chaque point lumineux et chaque appareil fixe compte.
- Un circuit qui comporte une prise est en **2,5 mm² au moins**.
- Calibre maximal du disjoncteur par section : 1,5 mm² → 16 A ; 2,5 → 20 A ; 4 → 25 A ; 6 → 40 A ;
  10 → 63 A.
- Au moins **deux circuits d'éclairage** (sauf logement d'au plus deux locaux).
- Différentiel général de 300 mA au plus en tête ; **30 mA** pour les circuits de salle de bains ou
  de douche, et pour lave-linge, sèche-linge et lave-vaisselle.
- Schémas : lettre par circuit, numéro par élément, type et section des câbles, mode de pose,
  différentiels et protections avec leur calibre ; datés, signés, avec l'adresse, en 3 exemplaires.

### France (NF C 15-100)

- Prises : **8 par circuit en 1,5 mm² / 16 A**, **12 en 2,5 mm² / 20 A**.
- Éclairage : 8 points par circuit, deux circuits au moins au-delà de 35 m².
- Un circuit par appareil spécialisé (plaque 32 A en 6 mm², lave-linge, lave-vaisselle, four…).
- Différentiels 30 mA : type A pour la plaque et le lave-linge, 8 circuits au plus par différentiel,
  20 % de réserve dans le tableau.
- Minimums de prises et de points lumineux par pièce.

## 6. Ce que l'outil ne fait pas

- Pas de calcul de puissance, de chute de tension ni de sélectivité.
- Pas de certification : le contrôle reste celui de l'organisme agréé (ou du Consuel).
- Le plan n'est pas un plan d'architecte : il sert à situer les points.
