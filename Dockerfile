# KEKS Werkzeugkasten – reines Node.js, keine npm-Abhängigkeiten, daher kein
# npm-install-Schritt nötig. node:sqlite ist fest in die Node-Binary
# eingebaut, läuft daher auch auf Alpine ohne native Kompilierung.
FROM node:22-alpine

WORKDIR /app

COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY tools ./tools

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
