# Esquiva — contexto para Claude

Responde siempre en español.

## Qué es esto

Un experimento de Manu (GitHub: `Manuu431`): un arcade de reflejos para el navegador, multijugador
en tiempo real (2-6, WebRTC con PeerJS, sin servidor propio), con bots que son redes neuronales
pequeñas entrenadas por neuroevolución en Node, más un bot planificador («Modo Dios»).

- Juego publicado: https://manuu431.github.io/esquiva/ (GitHub Pages desde `main`, raíz del repo).
- Repositorio: https://github.com/Manuu431/esquiva (público, licencia MIT).
- **`LOG.md` es el diario completo**: decisiones, problemas, métricas por generación y, al final,
  un «Punto de control» con lo pendiente. Léelo antes de tocar nada; `README.md` explica el diseño.

## Cómo quiere Manu que se trabaje

- De forma autónoma, tomando decisiones, y manteniendo `LOG.md` al día: al acabar cada iteración,
  qué se hizo, qué problemas hubo, métricas y qué sigue.
- Solo dentro de la carpeta del juego. No tocar sus archivos personales ni usar sus credenciales;
  los inicios de sesión (por ejemplo `gh auth login`) los hace él.
- **Preguntar antes de `git push` o de publicar.** En la sesión original dio permiso permanente
  para aquella sesión; en una sesión nueva hay que volver a confirmarlo.
- Preguntar antes de instalar algo grande, y decir siempre qué se instala.
- El portátil es antiguo (i7-4700MQ, 8 GB, sin GPU útil): entrenamientos de un hilo, a prioridad
  baja, con poblaciones pequeñas. Un entrenamiento tarda entre 20 minutos y 2 horas.
- Resultados honestos: los experimentos que salen mal se cuentan y se descartan (hay varios en el
  LOG). Un bot nuevo solo se publica si gana al publicado en una comparación larga.
- Le gusta que se le propongan ideas con datos (medir antes de opinar) y elegir él.

## Entorno

Hace falta Node.js 22 o posterior y, para las pruebas de navegador, Chrome o Chromium (se usa el
instalado, en modo headless; `tools/cdp.js` lo busca, o se fuerza con la variable `CHROME`). No
hay dependencias de npm. El proyecto nació en Windows 10 y pasó a Xubuntu en el mismo portátil.

Los commits van con la identidad `Manuu431 <155968407+Manuu431@users.noreply.github.com>` (su
dirección noreply de GitHub, para no publicar su correo). Tras clonar hay que fijarla en el repo:

```
git config user.name "Manuu431"
git config user.email "155968407+Manuu431@users.noreply.github.com"
```

## Comandos

```
npm run serve                      # el juego en http://127.0.0.1:8080
npm test                           # tests de Node (simulación, bots, registro, red simulada)
node test/browser/solo.js          # partida real en Chrome headless
node test/browser/online.js        # dos pestañas por PeerJS (necesita Internet); admite --lag 75 y una URL
node test/browser/six.js           # sala llena
node test/browser/relevo.js        # el anfitrión se va y otro toma el relevo
node train/evolve-arena.js --name X --gens 200      # entrena bots (parte de weights.json)
node train/export.js --run arena3 --easy tca        # regenera weights.json y lo compara con el publicado
node train/tune-god.js             # ajusta el Modo Dios
```

Antes de publicar: `npm test` y las cuatro pruebas de navegador. Después de publicar: esperar a
que Pages sirva la versión nueva y pasar `node test/browser/online.js https://manuu431.github.io/esquiva/`.

## Cosas que muerden

- **Caché del navegador:** en cada publicación que toque JS o CSS hay que subir el `?v=N` de
  `index.html` (todas las etiquetas a la vez).
- **Formato de los bots:** si cambia el tamaño del genoma, `NN.upgrade` debe convertir los
  antiguos y `NN.OLD_SIZES` listarlos; si no, el juego rechaza `weights.json` y se queda sin bots
  en silencio. `test/browser/solo.js` falla si eso pasa: no quitar esa comprobación.
- **Protocolo de red:** si cambia lo que viaja en las instantáneas, subir `PROTOCOL` en
  `js/netcode.js` para que una pestaña con la versión vieja reciba el aviso de recargar.
- **Nada que haga depender la trayectoria de un proyectil de lo que hace un jugador** (enemigos
  que persiguen, cámara lenta...). El invitado dibuja los proyectiles adelantados porque su
  trayectoria se conoce de antemano (`Sim.hazardPos`); es lo que hace jugable el multijugador con
  retraso. Rebotes, minas y zigzag valen porque son función del tiempo.
- **El silencio no es una caída:** una pestaña puede congelarse unos segundos. El relevo de
  anfitrión solo se dispara si la conexión se cierra o tras 25 s sin noticias (ver LOG, iteración 10).
- **Las pruebas de navegador** tienen afirmaciones de tiempo que fallan a ratos con el portátil
  cargado (por ejemplo, entrenando a la vez). Repetir antes de dar un fallo por real.
- `train/runs/` guarda los campeones de cada generación de cada entrenamiento; `export.js` los
  necesita (`tca` para los niveles fáciles, el último entrenamiento en arena para los difíciles).
- Los scripts de `train/` cargan `js/sim.js` al arrancar: cambiar una regla con un entrenamiento
  en marcha lo deja entrenando con la regla vieja. Parar, cambiar y relanzar.

## Estado y pendientes

Ver el último «Punto de control» de `LOG.md`. En resumen, al pasar a Xubuntu (2026-10-10): todo lo
pedido está hecho y publicado. Abierto, a elección de Manu:

- Probar con gente de verdad: redes distintas, móvil real, sala de 6. Nunca se ha hecho.
- Sus partidas en solitario, para comparar humano y bots (el juego las guarda en el navegador).
- Equilibrio: con la racha, aguantar vale muy poco frente a las estrellas.
- Ideas sin hacer: tormenta como regla opcional (idea suya), partida a varias rondas, modos por
  equipos, mejoras para móvil, algo que hacer al caer pronto, repeticiones compartibles.
- Mejoras: sensores de la red (aguanta 51 s frente a los 208 s del Modo Dios), conservar ronda y
  marcador en el relevo, estabilizar las pruebas de navegador, partir `js/main.js`.
- Preguntó por replicar agar.io con una skill `replica-skill`: no estaba disponible. Un juego de
  ese estilo, con código y gráficos propios, sería un proyecto aparte en otra carpeta.
