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
- Siempre hay **3 estrellas** en la arena; cuando alguien coge una, aparece otra lejos de él.
- Puntos: 1 por cada tick en pie (60 por segundo) y **300 por estrella**.
- La ronda acaba cuando solo queda uno en pie. **Gana quien más puntos tiene**, no necesariamente
  quien más aguanta: ir a por las estrellas es arriesgado y rentable.
- Los proyectiles salen cada vez más rápido y más seguidos. Nadie aguanta mucho más de 3 minutos.
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
| `js/netcode.js` | Reglas de sala y sincronización. No sabe nada de PeerJS, así que se prueba en Node con una red simulada. |
| `js/net.js` | El transporte: PeerJS / WebRTC. |
| `js/render.js`, `js/input.js`, `js/audio.js`, `js/main.js` | Dibujo en canvas, teclado y táctil, sonido y menús. |
| `weights.json` | Los bots: los pesos de las redes, por niveles. Lo genera el entrenamiento. |
| `train/` | La neuroevolución (Node). |
| `test/` | Tests. |

### Los bots

Cada bot percibe 32 números: para cada una de 8 direcciones, el proyectil más amenazante (cómo de
cerca está, cómo de inminente es el impacto y por qué lado pasaría de largo), la cercanía de las 4
paredes, hacia dónde queda la estrella más cercana y si es invulnerable. De ahí salen dos números
que se convierten en una de las 9 acciones del teclado. No puede hacer nada que no pueda hacer una
persona.

El entrenamiento (`train/evolve.js`) es un algoritmo evolutivo clásico: una población de 64 redes
al azar juega 8 partidas cada una; las mejores se quedan (élite), el resto se elige por torneo,
se cruzan neurona a neurona y se mutan con ruido gaussiano. Así 300 generaciones.

Resultados en 60 partidas que ningún bot había visto (detalle por generación en
`train/results/` y en `LOG.md`). Esta tabla es del entrenamiento original, cuando había una sola
estrella en la arena:

| jugador | puntos | aguanta |
|---|---:|---:|
| Quieto | 874 | 15 s |
| Aleatorio | 1245 | 20 s |
| Red sin entrenar (generación 0) | 1422 | 23 s |
| Red, generación 10 | 5553 | 32 s |
| Red, generación 80 | 8172 | 43 s |
| **Red, campeón final** | **11829** | **58 s** |
| Planificador escrito a mano con 250 ms de reacción | 4018 | 35 s |
| Planificador escrito a mano perfecto (techo del juego) | 16288 | 198 s |

Los niveles del juego salen de esa misma evolución: *Fácil* y *Normal* son campeones de
generaciones tempranas (la 6 y la 40); *Difícil* y *Experto* son el campeón final, con 100 ms de
tiempo de reacción y sin él. Con las reglas actuales (3 estrellas, 3 vidas, proyectiles normales)
hacen de media, jugando solos, 3285, 8015, 11039 y 15137 puntos.

Hubo dos entrenamientos. En el primero la red veía de cada proyectil «cerca y acercándose» y se
quedó en 8685 puntos. En el segundo ve «cuándo y por dónde pasará», con la misma red y el mismo
algoritmo, y llega a 11829. La red sigue lejos del planificador perfecto, que ve toda la arena sin
límite de alcance; ese margen queda para quien quiera seguir el experimento.

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
node train/evolve.js --name mio --gens 300 --pop 64 --episodes 8
node train/eval.js --run mio   # evaluación en partidas de test
node train/export.js --run mio # genera weights.json
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
