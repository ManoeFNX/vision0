PHONECAM ALERT — V11
====================

OUVRIR LE PROJET
1. Extrais tous les fichiers dans un même dossier.
2. Lance un serveur local (par exemple l’extension Live Server de VS Code) puis ouvre index.html.
3. Pour utiliser une caméra depuis un autre appareil, privilégie localhost sur le PC ou une adresse HTTPS accessible depuis le téléphone. Autorise les permissions caméra/micro demandées par le navigateur.

STRUCTURE
Tous les fichiers du projet sont volontairement placés au même niveau : aucune arborescence css/ ou js/ n’est nécessaire.

FICHIERS
index.html       Interface et toutes les vues
style.css        Design V11 responsive
storage.js       Paramètres, préférences et journal local
connection.js    Liaison PC / téléphone via PeerJS
camera.js        Vidéo, captures photo, audio et enregistrement
detection.js     Détection de mouvement
media.js         Médiathèque locale et gestion des captures
people.js        Gestion des personnes et photos de référence
recognition.js   Détection et comparaison faciale via face-api.js
app.js           Navigation, affichage, événements et paramètres
CHANGELOG.txt    Résumé des changements

DÉPENDANCES DISTANTES
Le projet charge PeerJS et face-api.js depuis leurs CDN. Les modèles de reconnaissance faciale sont téléchargés depuis le CDN face-api.js au premier chargement. Une connexion Internet est donc nécessaire pour charger ces dépendances si elles ne sont pas déjà mises en cache.

DONNÉES ET CONFIDENTIALITÉ
Les paramètres, événements et références de personnes sont stockés dans le stockage local du navigateur. Les captures peuvent être conservées dans le stockage géré par l’application. Ne partage pas l’accès au profil navigateur si ces données sont personnelles.

LIMITES DE TEST
Les fichiers et leurs références ont été contrôlés statiquement. Le fonctionnement du flux caméra, du microphone, des permissions et de la liaison entre deux appareils dépend aussi du navigateur, du HTTPS et du réseau ; il doit être validé sur les appareils réellement utilisés.
