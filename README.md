# Esquiva

**Juega aquí: https://manuu431.github.io/esquiva/**

Arcade de reflejos para el navegador. Esquiva los proyectiles, coge estrellas y suma más puntos
que nadie. Se juega solo, contra bots o con 2-6 amigos en tiempo real, sin instalar nada.

Los bots no están programados a mano: son redes neuronales pequeñas (422 números cada una) que
aprendieron a jugar por **neuroevolución**, y corren en tu navegador junto a los humanos.

## Cómo se juega

- Muévete con **WASD** o las **flechas** (en móvil, arrastra el dedo). **M** silencia, **Esc** sale.
- Tienes 3 vidas (se puede elegir de 1 a 5). Cada impacto quita una y te deja 1,5 s de
  invulnerabilidad.
- Siempre hay **3 estrellas** en la arena; cuando alguien coge una, aparece otra. Nunca aparecen
  encima ni cerca de un jugador (cuantos más jugadores, más lejos de todos).
- Puntos: 1 por cada tick en pie (60 por segundo) y **300 por estrella**.
- La ronda acaba cuando solo queda uno en pie. **Gana quien más puntos tiene**, no necesariamente
  quien más aguanta: ir a por las estrellas es arriesgado y rentable.
- Los proyectiles salen cada vez más rápido y más seguidos. Nadie aguanta mucho más de 3 minutos.
- **Mis partidas** (en el menú) guarda cada partida con sus puntos y sus ajustes: récords por
  modo, y filtros para ver tu media con más o menos bots, niveles, vidas o proyectiles. Se guarda
  solo en tu navegador.
- Antes de empezar se elige la dificultad de los proyectiles: **Suave**, **Normal** o **Intensa**
  (cambia su velocidad y cada cuánto salen). En una sala, vidas y dificultad las fija el anfitrión.

### Con amigos

1. Uno pulsa **Crear sala** y pasa el código de 5 letras (o el enlace con «Copiar enlace»).
2. Los demás escriben el código y pulsan **Unirse**.
3. El anfitrión elige cuántos bots rellenan la partida y pulsa **Empezar**.

Límites que conviene conocer:

- **Máximo 6 jugadores** por sala, contando bots.
- **Si el anfitrión cierra la pestaña o pierde la conexión, la partida termina** para todos. No hay
  traspaso de anfitrión. Que cree la sala quien tenga mejor conexión y ordenador.
- **El retraso de red se nota** en un juego tan rápido. El juego lo compensa (ver más abajo) y va
  bien hasta unos 150 ms de ida y vuelta; por encima empieza a costar.
- No hay servidor propio. Para encontrarse se usa el servidor público gratuito de
  [PeerJS](https://peerjs.com/), y después los datos van directos entre navegadores (WebRTC).
  Si ese servidor está caído no se pueden crear salas, y algunas redes (corporativas, algunos
  móviles) no permiten la conexión directa.
- Es un juego entre amigos: el anfitrión manda y nada impide que haga trampas.

## Cómo está hecho

Sin frameworks ni paso de compilación: HTML, CSS y JavaScript tal cual.

| fichero | qué hace |
|---|---|
| `js/sim.js` | Toda la lógica del juego. Pura y determinista (misma semilla, misma partida), sin pantalla: se usa igual en el navegador y en Node. |
| `js/nn.js` | Los sensores del bot y su red neuronal (32 entradas, 12 neuronas ocultas, 2 salidas). |
| `js/stats.js` | El registro de partidas del jugador: guardar, filtrar y resumir. |
| `js/netcode.js` | Reglas de sala y sincronización. No sabe nada de PeerJS, así que se prueba en Node con una red simulada. |
| `js/net.js` | El transporte: PeerJS / WebRTC. |
| `js/render.js`, `js/input.js`, `js/audio.js`, `js/main.js` | Dibujo en canvas, teclado y táctil, sonido y menús. |
| `weights.json` | Los bots: los pesos de las redes, por niveles. Lo genera el entrenamiento. |
| `train/` | La neuroevolución (Node). |
| `test/` | Tests. |

### Los bots

Cada bot percibe 32 números: para cada una de 8 direcciones, el proyectil más amenazante (cómo de
cerca está, cómo de inminente es el impacto y por qué lado pasaría de largo), la cercanía de las 4
paredes, hacia dónde queda **su estrella objetivo** y si es invulnerable. De ahí salen dos números
que se convierten en una de las 9 acciones del teclado. No puede hacer nada que no pueda hacer una
persona.

La estrella objetivo no es siempre la más cercana. El bot descarta la que un rival va a coger
antes: a su distancia a cada estrella le suma una penalización por la ventaja que le lleva el rival
que va hacia ella, y va a por la de menor coste. Cuánto pesa esa penalización son dos números que
forman parte de su «genoma» y que ajusta la evolución, igual que los pesos de la red.

El entrenamiento es un algoritmo evolutivo clásico: una población de 64 redes juega varias
partidas; las mejores se quedan (élite), el resto se elige por torneo, se cruzan neurona a neurona
y se mutan con ruido gaussiano. Tiene dos fases:

1. **En solitario** (`train/evolve.js`, 300 generaciones desde redes al azar): aprender a esquivar
   y a coger estrellas.
2. **En arena** (`train/evolve-arena.js`, 200 generaciones más): cada bot juega contra otros tres de
   su población, así que lo que se selecciona es jugar bien *contra otros*.

Resultados jugando solos, en 60 partidas que ningún bot había visto y con las reglas de referencia
(3 estrellas, 3 vidas, proyectiles normales). Detalle por generación en `train/results/` y en
`LOG.md`.

| jugador | puntos | aguanta |
|---|---:|---:|
| Quieto | 828 | 14 s |
| Aleatorio | 1376 | 20 s |
| Red sin entrenar (generación 0) | 1480 | 22 s |
| Red, generación 10 | 7379 | 33 s |
| Red, generación 80 | 11321 | 46 s |
| Red, campeón de la fase en solitario | 15636 | 60 s |
| **Red, campeón final (tras la fase en arena)** | **16582** | **62 s** |
| Planificador escrito a mano con 250 ms de reacción | 4510 | 34 s |
| Planificador escrito a mano perfecto (techo del juego) | 17682 | 202 s |

Y lo que importa en una partida de verdad, unos contra otros: en 80 partidas de 4 bots (dos
campeones finales contra dos campeones de la fase en solitario), los finales hacen 14688 puntos
frente a 11269 y ganan el 96 % de las rondas. Por separado, solo el criterio de estrella da un
81 % de victorias y solo la red nueva un 69 %.

Los niveles del juego salen de esa misma evolución. *Fácil* y *Normal* son campeones de
generaciones tempranas de la fase en solitario (la 6 y la 40) y van siempre a la estrella más
cercana. *Difícil* y *Experto* son el campeón final, con 100 ms de tiempo de reacción y sin él.
Jugando solos hacen de media 3282, 7757, 10982 y 16582 puntos.

Lo que no salió: dos entrenamientos se descartaron (los primeros sensores, que solo decían «cerca
y acercándose», y un intento de entrenar desde cero mezclando dificultades, que quedó por debajo).
Y la red sigue lejos del planificador perfecto en aguante (62 s frente a 202 s): coge más del doble
de estrellas que él, pero cae mucho antes. Ese margen queda para quien quiera seguir.

### El retraso de red

El anfitrión es la autoridad: ejecuta la simulación y envía el estado 20 veces por segundo. Para
que un invitado no juegue «en el pasado»:

1. **Su propio jugador se mueve al instante** en su pantalla (predicción) y se corrige con lo que
   confirma el anfitrión.
2. **Los proyectiles se dibujan adelantados** un viaje de ida y vuelta. Como van en línea recta se
   pueden extrapolar exactamente, así que el invitado ve la arena como estará en el anfitrión
   cuando llegue la tecla que pulsa ahora. Lo que esquiva en su pantalla, lo esquiva de verdad.

Medido con red simulada (un planificador perfecto jugando como invitado): con 150 ms de ida y
vuelta aguanta lo mismo que en local; con 300 ms, el 81 %; y con 150 ms *sin* estas dos técnicas,
solo el 43 %.

## Desarrollo

Hace falta [Node.js](https://nodejs.org/) 22 o posterior. No hay dependencias que instalar.

```
npm run serve                  # el juego en http://127.0.0.1:8080
npm test                       # tests de simulación, red neuronal y código de red

node test/browser/solo.js      # partida real en Chrome headless (usa el Chrome instalado)
node test/browser/online.js    # dos pestañas reales conectadas por PeerJS (necesita Internet)

node train/baselines.js        # jugadores de referencia
node train/evolve.js --name mio --gens 300 --pop 64 --episodes 8   # fase en solitario
node train/eval.js --run mio         # evaluación en partidas de test
node train/evolve-arena.js --name mia --gens 200                  # fase en arena (parte de weights.json)
node train/arena.js                  # dos tipos de bot frente a frente
node train/export.js --run mia --easy mio                         # genera weights.json
```

Las pruebas de navegador aceptan una dirección para probar el juego ya publicado:

```
node test/browser/online.js https://manuu431.github.io/esquiva/
```

El entrenamiento usa un solo hilo a prioridad baja. En un portátil de 2013 (i7-4700MQ) las 300
generaciones tardan unos 25 minutos.

## Licencia y créditos

- Código bajo licencia [MIT](LICENSE).

- [PeerJS](https://github.com/peers/peerjs) 1.5.5 (licencia MIT), incluido en `js/vendor/`.
- Hecho como experimento con Claude Code. El diario completo de decisiones, problemas y métricas
  está en [`LOG.md`](LOG.md).
