# LOG del experimento

Registro de decisiones, problemas, métricas y siguientes pasos. Lo más reciente va al final.

## Plan (2026-10-10)

**Juego: "Esquiva"** — arena cerrada vista desde arriba. Cada jugador es un círculo que se mueve en 8
direcciones. Desde los bordes entran proyectiles que cruzan la arena cada vez más rápido y más seguidos.
Cada jugador tiene 3 vidas; al recibir un impacto pierde una y queda invulnerable un instante. Hay una
estrella en la arena que da puntos al cogerla (obliga a moverse: no vale acampar en una esquina).
La ronda acaba cuando solo queda uno en pie; en solitario se juega a aguantar y puntuar.

Por qué este juego:
- Es puro reflejo, se entiende en 5 segundos y admite 2-6 jugadores sin cambiar reglas.
- Los jugadores no chocan entre sí, así que el retraso de red solo afecta a "yo contra los proyectiles".
- Los proyectiles van en línea recta: el cliente puede extrapolarlos y se ven fluidos aunque lleguen
  pocos paquetes por segundo.
- Es un buen problema para neuroevolución: entradas pequeñas, recompensa densa (tiempo vivo + estrellas).

**Arquitectura**
- `js/sim.js`: lógica pura, determinista (PRNG con semilla, paso fijo de 1/60 s), sin DOM. Se carga
  igual en Node y en el navegador.
- `js/nn.js`: red neuronal pequeña (percepción -> capa oculta tanh -> 2 salidas de movimiento) + sensores.
- `js/render.js`, `js/input.js`, `js/audio.js`, `js/main.js`, `index.html`: dibujo en canvas,
  teclado/táctil, sonido, menús.
- `js/netcode.js` + `js/net.js`: salas con PeerJS. El anfitrión ejecuta `sim.js` y es la autoridad;
  los invitados envían sus teclas y reciben instantáneas.
- `train/`: neuroevolución en Node (población, torneo, mutación, elitismo). Exporta `weights.json`.
- `test/`: tests en Node con `node:test` (sin dependencias) y pruebas en navegador real.

**Fases**
1. Prototipo de un jugador + simulación sin pantalla + tests.
2. Entrenamiento evolutivo, métricas por generación, comparación con humano.
3. Multijugador por salas con PeerJS, probado con dos pestañas.
4. Pulido, README y publicación en GitHub Pages (con confirmación).

**Límites conocidos (de diseño)**
- Pensado para ~6 jugadores: el anfitrión mantiene una conexión WebRTC con cada invitado.
- Si el anfitrión se cae o cierra la pestaña, la partida termina (no hay migración de anfitrión).
- El retraso de red se nota en un juego rápido; el diseño lo compensa en parte (ver iteración 3).
- Sin servidor propio: la señalización depende del servidor público gratuito de PeerJS. PeerJS
  trae configurados un STUN de Google y unos TURN comunitarios; ayudan con redes difíciles, pero
  son gratuitos y sin garantía: puede haber redes (corporativas, algunos móviles) que no conecten.

## Entorno e instalaciones

- Windows 10, i7-4700MQ, 8 GB RAM (~4 GB libres al empezar). git 2.55 ya estaba instalado.
- **Instalado: Node.js v24.21.0 LTS en modo portable** (zip oficial de nodejs.org, SHA256 verificado),
  en `.tools/node/` dentro de la carpeta del juego (102 MB). No modifica PATH ni registro, no
  requiere administrador. Para desinstalar: borrar `.tools/`. Está excluido de git.
- **Descargado: PeerJS 1.5.5** (`js/vendor/peerjs.min.js`, 87 KB, licencia MIT, desde unpkg). Va
  dentro del repositorio para no depender de un CDN al jugar.
- Nada más. Sin dependencias npm. Para las pruebas en navegador se usa el Chrome ya instalado, en
  headless y con un perfil temporal en `.tools/` (no toca el perfil personal).

## Iteración 1 — Fase 1: prototipo + simulación + tests (2026-10-10)

Hecho:
- `js/sim.js`: lógica pura y determinista (PRNG mulberry32 guardado en el estado, paso fijo 1/60 s).
- `js/nn.js`: sensores (8 sectores x [cercanía, acercamiento, lado] + 4 paredes + estrella +
  invulnerabilidad = 32 entradas) y red 32 -> 12 tanh -> 2 tanh (422 pesos). La salida se umbraliza a
  -1/0/1 por eje: el bot solo puede hacer lo mismo que un humano con el teclado.
- Dibujo en canvas sin sombras ni filtros (pensado para el portátil), teclado + táctil, sonido sintetizado.
- `tools/cdp.js`: maneja Chrome headless por su protocolo de depuración, sin instalar Playwright.

Decisiones:
- Un proyectil nunca nace a menos de 150 px de un jugador (hasta 4 reintentos): sin muertes "sin aviso".
- El radio de impacto es el 85 % del dibujado: los roces no cuentan.
- La simulación la mueve un temporizador en un Web Worker, no `requestAnimationFrame`: así no se
  congela cuando la pestaña del anfitrión queda en segundo plano. En local sí se pausa si no se mira.

Problemas:
- `node --test test/` ya no acepta carpetas en Node 24: se usa el patrón `test/*.test.js`.
- La rampa de dificultad inicial nunca llegaba a ser imposible: un planificador perfecto aguantaba
  indefinidamente, así que una ronda con bots buenos podía no acabar. Añadido un término cúbico
  ("muerte súbita") al ritmo de aparición. Ahora el planificador perfecto cae a los ~200 s: ese es
  el techo del juego y la duración máxima de cualquier ronda.

## Iteración 2 — Fase 2: neuroevolución (2026-10-10)

Algoritmo (`train/evolve.js`): población 64, 8 partidas por individuo y generación (las mismas
para todos dentro de una generación, nuevas en cada generación), élite de 4, selección por torneo
de 3, cruce por neuronas completas (70 %), mutación gaussiana (8 % de los pesos, sigma 0,35 que
decae a 0,08). Fitness = puntos medios (1 por tick vivo + 300 por estrella). Un hilo, prioridad
baja, pausa de 150 ms entre generaciones. 300 generaciones tardaron unos 25 min.

Métricas por generación (extracto de `train/runs/base/log.csv`; "validación" = el campeón de esa
generación en 20 partidas fijas que nunca se usan para entrenar):

| gen | mejor | media población | validación (puntos) | validación (s) | estrellas |
|----:|------:|----------------:|--------------------:|---------------:|----------:|
|   0 |  1476 |            1068 |                1475 |           23,6 |       0,2 |
|  25 |  6712 |            4764 |                6461 |           33,2 |      14,9 |
|  50 |  7288 |            5726 |                6110 |           30,8 |      14,2 |
| 100 |  8712 |            6554 |                6526 |           29,3 |      15,9 |
| 150 |  9861 |            7994 |                8932 |           46,9 |      20,4 |
| 200 | 10427 |            8489 |                8963 |           43,6 |      21,1 |
| 250 | 10612 |            8947 |                9405 |           46,5 |      22,1 |
| 299 | 10810 |            9301 |                9188 |           49,1 |      20,8 |

La fitness sube: la media de la población se multiplica por 8,7 y el campeón por ~6. Primero
aprenden a ir a por la estrella (generaciones 1-25), después a esquivar mientras tanto (100-150).
A partir de la 150 mejora despacio.

Comparación en 60 partidas de TEST (semillas distintas de las de entrenamiento y validación):

| jugador                                                  | puntos | segundos     | estrellas |
|----------------------------------------------------------|-------:|-------------:|----------:|
| Quieto                                                   |    874 | 14,6 ± 3,8   |       0,0 |
| Aleatorio                                                |   1245 | 20,2 ± 6,6   |       0,1 |
| Red, generación 0                                        |   1458 | 23,3 ± 7,6   |       0,2 |
| Red, generación 10                                       |   3529 | 28,5 ± 7,3   |       6,1 |
| Red, generación 80                                       |   6567 | 31,3 ± 10,4  |      15,6 |
| **Red, campeón final (gen 272)**                         | **8685** | **48,1 ± 13,3** | **19,3** |
| Campeón final con 100 ms de reacción                     |   7145 | 42,9 ± 11,4  |      15,2 |
| Planificador a mano, reacción 250 ms ("humano simulado") |   4018 | 34,5 ± 9,5   |       6,5 |
| Planificador a mano perfecto (techo del juego)           |  16288 | 198,4 ± 11,1 |      14,6 |

Lectura honesta:
- **Todavía no hay comparación con un humano de verdad**: yo no puedo jugar. El "humano simulado"
  es un planificador escrito a mano al que se le añade tiempo de reacción; es una aproximación
  burda. Falta que juegues tú unas partidas en solitario.
- La red supera al "humano simulado" (8685 frente a 4018 puntos), pero queda lejos del
  planificador perfecto en supervivencia (48 s frente a 198 s). Ese planificador ve toda la arena
  con precisión perfecta; la red solo ve el proyectil más amenazante de cada uno de 8 sectores
  hasta 260 px. Hay margen: mejores sensores es el siguiente experimento.
- Elegir campeón con solo 20 partidas de validación era ruidoso (el "mejor por validación" salía
  peor en test que otros). Ahora los 10 mejores se vuelven a medir con 60 partidas nuevas.

Cambio de regla a raíz del entrenamiento: la fitness premiaba puntos (y los bots salieron
avariciosos con las estrellas), pero la ronda la ganaba el último en pie, así que las estrellas no
servían para ganar. **Ahora gana quien más puntos tiene cuando solo queda uno en pie.** Coger
estrellas es arriesgado y rentable; fitness y regla del juego dicen lo mismo.

Niveles exportados a `weights.json` (61 KB), medidos en test:

| nivel   | red            | reacción | puntos | segundos |
|---------|----------------|---------:|-------:|---------:|
| Fácil   | campeón gen 11 |   150 ms |   3144 |     28,6 |
| Normal  | campeón gen 60 |   100 ms |   5937 |     29,6 |
| Difícil | campeón final  |   100 ms |   7145 |     42,9 |
| Experto | campeón final  |     0 ms |   8685 |     48,1 |

Problema encontrado en el navegador: varios bots con la misma red ven lo mismo, deciden lo mismo y
acaban superpuestos (solapados el 58 % del tiempo). Cada nivel lleva ahora 5 redes distintas
(campeones de generaciones diferentes) y cada bot usa la suya: solapamiento 15 %.

## Iteración 3 — Fase 3: multijugador con PeerJS (2026-10-10)

Diseño (`js/netcode.js` = reglas, sin PeerJS ni DOM; `js/net.js` = transporte PeerJS):
- El anfitrión ejecuta `sim.js` y envía instantáneas completas 20 veces por segundo. Sala con
  código de 5 caracteres (sin 0/O/1/I) y enlace directo `.../#CODIGO`. Máximo 6 entre humanos y bots.
- Una partida local es un anfitrión sin invitados: el mismo código sirve para todo.
- Contra el retraso de red, dos técnicas en el invitado:
  1. **Predicción del propio jugador**: se mueve al instante en su pantalla y se reconcilia con lo
     que confirma el anfitrión (se reaplican las pulsaciones aún no confirmadas).
  2. **Proyectiles adelantados**: como van en línea recta, el invitado los dibuja extrapolados un
     viaje de ida y vuelta, es decir, como estarán en el anfitrión cuando llegue la tecla que está
     pulsando ahora. Lo que esquivas en tu pantalla lo esquivas de verdad, sin que el anfitrión
     tenga que fiarse de nada que diga el invitado.
- Canal WebRTC sin orden garantizado (un paquete lento no frena a los siguientes); los mensajes
  van numerados y el estado de la sala se repite cada segundo.
- Quien entra con la ronda empezada la ve como espectador y juega la siguiente. Si un invitado se
  va, queda eliminado de la ronda. Si el anfitrión desaparece, el invitado lo detecta (cierre del
  canal o 6 s sin noticias) y vuelve al menú con un aviso.

Descartado: compensación de retraso en el anfitrión (rebobinar proyectiles según el retraso que
declara cada invitado). Llegué a implementarla en `sim.js`, pero adelantar los proyectiles en el
invitado consigue lo mismo sin tocar la simulación ni fiarse del invitado. Eliminada.

Medición con red simulada (planificador perfecto jugando como invitado, decidiendo con lo que ve
en su pantalla; 10 partidas con tope de 90 s; retraso con ±15 % de variación):

| situación                                        | aguanta | respecto a local |
|--------------------------------------------------|--------:|-----------------:|
| local, sin red                                   |  90,0 s |            100 % |
| 50 ms ida y vuelta                               |  90,0 s |            100 % |
| 150 ms ida y vuelta                              |  90,0 s |            100 % |
| 300 ms ida y vuelta                              |  72,6 s |             81 % |
| 150 ms sin predicción ni proyectiles adelantados |  38,5 s |             43 % |

Pruebas:
- 46 tests en Node (`npm test`): simulación, red neuronal y código de red con red simulada
  (retraso, variación, desorden, desconexiones, sala llena, versión distinta).
- `test/browser/solo.js`: partida real en Chrome headless, sola y contra 3 bots.
- `test/browser/online.js`: **dos pestañas reales** conectadas por PeerJS/WebRTC: crear sala,
  entrar con enlace, moverse ambos, fin de ronda, segunda ronda y cierre del anfitrión. En local:
  5,9 ms de ida y vuelta.

Límites que siguen ahí:
- Las pruebas de red reales han sido dos pestañas en el mismo ordenador. **No está probado entre
  dos redes distintas ni con 6 personas.** Eso solo se puede comprobar publicándolo y jugando.
- Lo que no arregla el diseño: los demás jugadores se ven con algo de retraso (da igual para
  esquivar, importa un poco en la carrera por la estrella); un proyectil recién nacido aparece unos
  píxeles dentro del borde; y con retraso muy variable la extrapolación baila.

Siguiente: guardar las partidas del humano para compararlas con los bots, README, pulido, y
preguntar por la publicación. En paralelo, segundo experimento de entrenamiento con mejores sensores.

## Iteración 4 — Fase 4 (parte 1): pulido y prueba de sala llena (2026-10-10)

Hecho:
- Detrás del menú se ve una partida de exhibición entre 4 bots Experto.
- El juego guarda las partidas en solitario del humano (en el navegador, `localStorage`) y enseña
  su récord y su media junto a la media de cada nivel de bot: es la comparación humano-bot que
  falta por rellenar con datos reales.
- Botones de sonido y de salir (para móvil, donde no hay Esc). El control táctil funciona en toda
  la pantalla y está probado en la prueba de navegador.
- README.
- `test/browser/six.js`: **sala llena con 6 pestañas reales** (1 anfitrión + 5 invitados). Entran
  todos, el séptimo recibe "sala llena", cada invitado mueve a su jugador y el anfitrión mantiene
  60,2 Hz en este portátil con las 6 pestañas abiertas.

Ajuste: si el aviso de fin de ronda llegaba antes que la instantánea final (el canal no ordena),
el invitado tardaba hasta 1 s en ver los resultados. Ahora los muestra en cuanto llega cualquiera
de las dos cosas.

## Iteración 5 — Segundo experimento de entrenamiento: sensores de cruce (2026-10-10)

Hipótesis: a la red le faltaba geometría. Con "cerca" y "acercándose" tiene que deducir si un
proyectil le va a dar; un planificador lo calcula directamente. Cambio único, en los sensores:
de cada sector se sigue mirando un solo proyectil, pero ahora se describe con
- cercanía (igual que antes),
- inminencia del impacto: 1 si va a dar ya, 0 si no viene o pasará a más de 50 px,
- lado por el que pasaría de largo (0 si viene centrado).

Mismo número de entradas (32), misma red (422 pesos), mismo algoritmo, misma semilla. Se entrenó
en una copia aparte para no tocar el juego hasta saber el resultado.

Métricas por generación (`train/results/tca.csv`; entre paréntesis, el primer entrenamiento):

| gen | media población | validación (puntos) | validación (s) |
|----:|----------------:|--------------------:|---------------:|
|   0 |   1113   (1068) |       1351   (1475) |    21,8 (23,6) |
|  50 |   6924   (5726) |       7745   (6110) |    39,1 (30,8) |
| 100 |   9181   (6554) |       9351   (6526) |    55,3 (29,3) |
| 150 |  10215   (7994) |      10276   (8932) |    50,5 (46,9) |
| 200 |  10468   (8489) |      10918   (8963) |    53,2 (43,6) |
| 250 |  10733   (8947) |      10718   (9405) |    59,9 (46,5) |
| 299 |  11270   (9301) |      11113   (9188) |    58,7 (49,1) |

En las 60 partidas de test: campeón final **11829 puntos, 57,9 ± 12,9 s, 27,9 estrellas**
(antes 8685 puntos, 48,1 s, 19,3 estrellas). Mejora del 36 % en puntos. Integrado.

Niveles nuevos en `weights.json`, medidos en test:

| nivel   | red                | reacción | puntos | segundos |
|---------|--------------------|---------:|-------:|---------:|
| Fácil   | campeón gen 6      |   150 ms |   2768 |     23,4 |
| Normal  | campeón gen 40     |   100 ms |   6199 |     33,3 |
| Difícil | campeón final (294)|   100 ms |   8413 |     42,5 |
| Experto | campeón final (294)|     0 ms |  11829 |     57,9 |

Lo que sigue sin resolverse: el planificador perfecto hace 16288 puntos y aguanta 198 s. La red
coge más estrellas que él (27,9 frente a 14,6) pero aguanta menos de un tercio. Ideas no probadas:
más de un proyectil por sector, alcance mayor, entrenar con varios bots a la vez en la arena.

## Publicación (2026-10-10)

Autorización del usuario: repositorio público `esquiva`, licencia MIT, commits reescritos con su
dirección noreply de GitHub antes del primer push, push y GitHub Pages sin más preguntas. Él solo
inicia sesión.

- **Descargado: GitHub CLI 2.102.0 portable** (zip oficial de github.com/cli/cli, SHA256
  verificado) en `.tools/gh/` (41 MB), con su configuración en `.tools/gh-config/`. Excluido de
  git. El inicio de sesión lo hace el usuario con `.tools/login-github.cmd`; yo no veo ni toco la
  contraseña ni el token (lo guarda GitHub CLI en el almacén de credenciales de Windows).
- Añadidos `LICENSE` (MIT) y `.nojekyll`.
