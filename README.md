# Esquiva

**Juega aquí: https://manuu431.github.io/esquiva/**

Arcade de reflejos para el navegador. Esquiva los proyectiles, coge estrellas y mejoras, y suma
más puntos que nadie. Se juega solo, contra bots o con 2-6 amigos en tiempo real, sin instalar nada.

Los bots no están programados a mano: son redes neuronales pequeñas que aprendieron a jugar por
**neuroevolución**, y corren en tu navegador junto a los humanos. (Hay una excepción declarada: el
«Modo Dios», que es un planificador.)

## Cómo se juega

- Muévete con **WASD** o las **flechas** (en móvil, arrastra el dedo). **P** pausa (en partidas
  locales), **M** silencia, **Esc** sale.
- Tienes 3 vidas (se puede elegir de 1 a 5). Cada impacto quita una y te deja 1,5 s de
  invulnerabilidad.
- Siempre hay **3 estrellas** en la arena; cuando alguien coge una, aparece otra. Nunca aparecen
  encima ni cerca de un jugador (cuantos más jugadores, más lejos de todos).
- Puntos: 1 por cada tick en pie (60 por segundo) y **300 por estrella**.
- La ronda acaba cuando solo queda uno en pie. **Gana quien más puntos tiene**, no necesariamente
  quien más aguanta: ir a por las estrellas es arriesgado y rentable.
- Los proyectiles salen cada vez más rápido y más seguidos. Todos son rojos; los que llevan un
  **anillo blanco rebotan** en las paredes y los más oscuros vienen en **ráfagas de tres**.
- Antes de empezar se elige su dificultad: **Suave**, **Normal**, **Intensa** o **Imposible**.

### Mejoras

Aparecen cada pocos segundos, lejos de los jugadores, y esperan 10 s. Se pueden desactivar.

| mejora | efecto |
|---|---|
| Turbo | 45 % más de velocidad durante 6 s |
| Fantasma | intangible 4 s: los proyectiles te atraviesan |
| Escudo | absorbe el siguiente impacto (dura 12 s) |
| Corazón | una vida más; con todas, 300 puntos |
| Bomba | destruye los proyectiles que tengas cerca |
| Doble | puntos dobles durante 8 s |
| Imán | coges las estrellas desde lejos durante 8 s |

### Bots

Hasta 5, de nivel **Fácil**, **Normal**, **Difícil** o **Experto** (redes neuronales), **Modo
Dios** (un planificador que no falla), **Mixto** (uno de cada nivel) o **Adaptativo** (el nivel
que te toca según cómo te ha ido).

### Más cosas

- **Mis partidas**: cada partida queda guardada en tu navegador con sus puntos y sus ajustes.
  Récords por modo, filtros para ver tu media con cada combinación, y exportación a CSV.
- **Repetición**: al acabar una ronda (si eres el anfitrión o juegas en local) puedes volver a
  verla, acelerada si quieres.
- **Cómo se juega**: en el menú, con lo que hace cada mejora.

### Con amigos

1. Uno pulsa **Crear sala** y pasa el código de 5 letras (o el enlace con «Copiar enlace»).
2. Los demás escriben el código y pulsan **Unirse**.
3. El anfitrión elige bots, vidas, proyectiles y mejoras, y pulsa **Empezar**.

Límites que conviene conocer:

- **Máximo 6 jugadores** por sala, contando bots.
- **Si el anfitrión se va, otro jugador toma el relevo** de la sala y los demás le siguen solos,
  con el mismo código. Lo que se pierde es la ronda en curso y el marcador de victorias. Si el
  anfitrión solo se queda congelado unos segundos, se le espera.
- **El retraso de red se nota** en un juego tan rápido. El juego lo compensa (ver más abajo) y va
  bien hasta unos 150 ms de ida y vuelta; por encima empieza a costar.
- No hay servidor propio. Para encontrarse se usa el servidor público gratuito de
  [PeerJS](https://peerjs.com/), y después los datos van directos entre navegadores (WebRTC).
  Si ese servidor está caído no se pueden crear salas, y algunas redes (corporativas, algunos
  móviles) no permiten la conexión directa.
- Es un juego entre amigos: el anfitrión manda y nada impide que haga trampas.
- Todas las pruebas de red se han hecho con varias pestañas en un mismo ordenador. Entre redes
  distintas y en móviles de verdad está sin comprobar.

## Cómo está hecho

Sin frameworks ni paso de compilación: HTML, CSS y JavaScript tal cual.

| fichero | qué hace |
|---|---|
| `js/sim.js` | Toda la lógica del juego. Pura y determinista (misma semilla, misma partida), sin pantalla: se usa igual en el navegador y en Node. |
| `js/nn.js` | Los sensores del bot, su red neuronal (35 entradas, 12 neuronas ocultas, 2 salidas) y su criterio para elegir objetivo. |
| `js/god.js` | El bot «Modo Dios»: un planificador que simula el futuro. |
| `js/stats.js` | El registro de partidas del jugador: guardar, filtrar, resumir y exportar. |
| `js/netcode.js` | Reglas de sala, sincronización y grabación de repeticiones. No sabe nada de PeerJS, así que se prueba en Node con una red simulada. |
| `js/net.js` | El transporte: PeerJS / WebRTC, y el relevo de anfitrión. |
| `js/render.js`, `js/input.js`, `js/audio.js`, `js/main.js` | Dibujo en canvas, teclado y táctil, sonido y menús. |
| `weights.json` | Los bots: los pesos de las redes por niveles y los parámetros del Modo Dios. Lo genera el entrenamiento. |
| `train/` | La neuroevolución (Node). |
| `test/` | Tests. |

### Los bots de red

Cada bot percibe 35 números: para cada una de 8 direcciones, el proyectil más amenazante (cómo de
cerca está, cómo de inminente es el impacto y por qué lado pasaría de largo), la cercanía de las 4
paredes, hacia dónde queda **su objetivo**, y cuatro avisos sobre sí mismo (invulnerable, con
turbo, intangible, con escudo). De ahí salen dos números que se convierten en una de las 9
acciones del teclado. No puede hacer nada que no pueda hacer una persona.

El objetivo no es siempre la estrella más cercana. Cada estrella y cada mejora tiene un coste, y
el bot va a por la de menor coste:

- a su distancia se le suma una penalización si un rival está más cerca y va hacia ella (para no
  ir a por lo que otro va a coger antes);
- a una mejora se le resta lo que el bot la valora, medido en píxeles de desvío.

Esos 9 números (2 para los rivales y uno por cada mejora) forman parte del «genoma» del bot junto
con los 458 pesos de la red, y los ajusta la evolución igual que los pesos. Lo que salió: el
campeón valora mucho el escudo (653 px), bastante el corazón (321), el fantasma (239) y el doble
(220), algo el imán (153), casi nada el turbo (18) y nada la bomba.

El entrenamiento es un algoritmo evolutivo clásico: una población de redes juega varias partidas;
las mejores se quedan (élite), el resto se elige por torneo, se cruzan neurona a neurona y se
mutan con ruido gaussiano. Ha tenido tres fases:

1. **En solitario** (`train/evolve.js`, 300 generaciones desde redes al azar): aprender a esquivar
   y a coger estrellas.
2. **En arena** (`train/evolve-arena.js`, 200 generaciones): cada bot juega contra otros tres de
   su población; aprende a competir por las estrellas.
3. **En arena con mejoras** (250 generaciones más, en mesas de 2, 4 y 6): aprende qué mejoras
   merecen el desvío.

Resultados jugando solos, en 60 partidas que ningún bot había visto, con las reglas de referencia
(3 estrellas, 3 vidas, proyectiles normales, con mejoras). Detalle por generación en
`train/results/` y en `LOG.md`.

| jugador | puntos | aguanta |
|---|---:|---:|
| Quieto | 828 | 14 s |
| Aleatorio | 1376 | 20 s |
| Red, generación 6 (nivel Fácil, con 150 ms de reacción) | 3533 | 23 s |
| Red, generación 40 (nivel Normal, con 100 ms de reacción) | 7349 | 31 s |
| Red, campeón final con 100 ms de reacción (nivel Difícil) | 10954 | 42 s |
| **Red, campeón final (nivel Experto)** | **17197** | **60 s** |
| **Modo Dios** (planificador; 20 partidas) | **72190** | **212 s** |

(Las dos primeras filas se midieron antes de que existieran las mejoras; quieto o al azar apenas
cambian.) Y unos contra otros, que es lo que importa en una partida de verdad, en 80 partidas de 4
bots, dos contra dos:

| quién | contra quién | puntos | rondas ganadas |
|---|---|---|---:|
| campeones de la fase 2 | campeones de la fase 1 | 14688 vs 11269 | 96 % |
| campeones de la fase 3 | campeones de la fase 2 | 14735 vs 12629 | 85 % |
| un Modo Dios | tres campeones de la fase 3 (20 partidas) | 23815 vs 13866 | 20 de 20 |

### El Modo Dios

No es una red: es un planificador. En cada decisión simula 40 ticks de futuro para 81 secuencias
de movimientos (9 direcciones, y a los 6 ticks otras 9), sabiendo exactamente por dónde irá cada
proyectil, rebotes incluidos, y se queda con la mejor. Ve toda la arena, no tiene tiempo de
reacción y no se equivoca al calcular; en el primer minuto no pierde ni una vida. Lo único que le
para es físico: a partir de unos 200 segundos ya no queda hueco por el que pasar. Sus parámetros
se ajustaron automáticamente (`train/tune-god.js`).

### Lo que no salió

- Los primeros sensores (solo «cerca y acercándose») se quedaron cortos y se cambiaron.
- Entrenar desde cero mezclando dificultades dio peor resultado que no hacerlo; se descartó.
- La primera versión del Modo Dios «procrastinaba»: como le valía cualquier ruta que llegase a la
  estrella, a veces esperaba quieto antes de ir. Se corrigió el criterio.
- La red sigue muy lejos del planificador en aguante (60 s frente a 212 s). Ve un proyectil por
  sector hasta 260 px; el planificador lo ve todo. Ese margen queda para quien quiera seguir.

### El retraso de red

El anfitrión es la autoridad: ejecuta la simulación y envía el estado 20 veces por segundo. Para
que un invitado no juegue «en el pasado»:

1. **Su propio jugador se mueve al instante** en su pantalla (predicción) y se corrige con lo que
   confirma el anfitrión.
2. **Los proyectiles se dibujan adelantados** un viaje de ida y vuelta. Su trayectoria se conoce
   de antemano (incluidos los rebotes), así que el invitado ve la arena como estará en el
   anfitrión cuando llegue la tecla que pulsa ahora. Lo que esquiva en su pantalla, lo esquiva de
   verdad. Por eso no hay mejoras que frenen o congelen proyectiles: romperían esto.

Medido con red simulada (un planificador perfecto jugando como invitado): con 150 ms de ida y
vuelta aguanta lo mismo que en local; con 300 ms, el 81 %; y con 150 ms *sin* estas dos técnicas,
solo el 43 %. Esa medición es anterior a las mejoras y a los proyectiles que rebotan.

## Desarrollo

Hace falta [Node.js](https://nodejs.org/) 22 o posterior. No hay dependencias que instalar.

```
npm run serve                  # el juego en http://127.0.0.1:8080
npm test                       # tests de simulación, bots, registro y código de red

node test/browser/solo.js      # partida real en Chrome headless (usa el Chrome instalado)
node test/browser/online.js    # dos pestañas reales conectadas por PeerJS (necesita Internet)
node test/browser/online.js --lag 75                    # ...con retraso de red simulado
node test/browser/online.js https://manuu431.github.io/esquiva/   # ...contra el juego publicado
node test/browser/six.js       # sala llena: 6 pestañas
node test/browser/relevo.js    # el anfitrión se va y otro toma el relevo (3 pestañas)

node train/baselines.js        # jugadores de referencia
node train/evolve.js --name mio --gens 300 --pop 64 --episodes 8   # fase en solitario
node train/evolve-arena.js --name mia --gens 250                  # fase en arena (parte de weights.json)
node train/tune-god.js         # ajusta los parámetros del Modo Dios
node train/arena.js            # dos tipos de bot frente a frente
node train/export.js --run mia --easy mio                         # genera weights.json
```

Añadir `?lag=75&jitter=20` a la dirección del juego retrasa lo que envía esa pestaña, para probar
cómo se juega con mala conexión.

El entrenamiento usa un solo hilo a prioridad baja. En un portátil de 2013 (i7-4700MQ) cada fase
tarda entre 20 y 45 minutos.

## Licencia y créditos

- Código bajo licencia [MIT](LICENSE).
- [PeerJS](https://github.com/peers/peerjs) 1.5.5 (licencia MIT), incluido en `js/vendor/`.
- Hecho como experimento con Claude Code. El diario completo de decisiones, problemas y métricas
  está en [`LOG.md`](LOG.md).
