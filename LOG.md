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

Hecho, en este orden:
1. El usuario inició sesión (cuenta `Manuu431`). ID obtenido con `gh api user`.
2. Los commits locales se reescribieron (autor y committer) con su dirección noreply de GitHub.
   Comprobado que no queda ninguna dirección personal ni en el historial ni en los ficheros.
3. Repositorio público creado: https://github.com/Manuu431/esquiva. Push de `main`.
   El push usa la sesión de GitHub CLI mediante una configuración local del repositorio; no se
   ha tocado la configuración global de git.
4. GitHub Pages activado desde la rama `main`, carpeta raíz. Tardó unos 30 s en compilar.
5. **Juego publicado en https://manuu431.github.io/esquiva/**

Verificación contra la URL pública:
- La página y sus ficheros responden 200 (`index.html`, `js/sim.js`, PeerJS, `weights.json`, CSS).
- `node test/browser/online.js https://manuu431.github.io/esquiva/`: dos pestañas reales crean una
  sala, una entra con el enlace, juegan, acaba la ronda, juegan otra y la invitada detecta el
  cierre del anfitrión. Pasa.
- Los 4 niveles de bot cargan y se puede jugar contra ellos; sin errores en la consola.

Lo que NO está verificado y solo se puede comprobar jugando de verdad:
- Dos o más personas en redes distintas (todas las pruebas han sido pestañas del mismo ordenador).
- Móvil real (el control táctil solo se ha probado emulado en Chrome).
- La comparación de los bots con un humano: falta que alguien juegue en solitario.

Para actualizar la web basta con hacer commit y `git push`; Pages se recompila sola.

## Iteración 6 — Peticiones tras jugar: 3 estrellas, dificultad y vidas (2026-10-10)

El usuario jugó y pidió tres cosas:
1. Varias estrellas a la vez (unas 3): con una sola, contra bots se la lleva siempre quien la
   tiene más cerca.
2. Dificultad elegible para los proyectiles.
3. Poder elegir el número de vidas.

Hecho:
- **3 estrellas siempre en la arena** (`STAR_COUNT`). Al coger una reaparece a más de 180 px de
  quien la cogió y a más de 140 px de las otras, para que haya varias carreras y no una. El bot
  sigue recibiendo 3 números sobre "la estrella": ahora son los de la más cercana, así que la red
  no cambia de forma y los pesos anteriores siguen valiendo.
- **Dificultad de los proyectiles**: Suave / Normal / Intensa. Multiplica la velocidad (x0,8 /
  x1 / x1,2) y el ritmo de aparición (x0,7 / x1 / x1,4). La rampa y la "muerte súbita" son las
  mismas, así que toda ronda sigue acabando (hay test).
- **Vidas de 1 a 5** (3 por defecto). El marcador dibuja las que haya.
- Las dos últimas son reglas de la ronda: se eligen en el menú en local y las fija el anfitrión
  en la sala; los invitados las ven antes de empezar.
- El récord y el historial "tú contra los bots" solo cuentan con las reglas de referencia (3 vidas,
  proyectiles normales); con otras reglas se guarda un récord aparte.
- Protocolo de red 2 (la instantánea lleva varias estrellas y las vidas máximas). Una pestaña con
  la versión anterior recibe el aviso de recargar la página.
- Menú y sala compactados: los cuatro ajustes en una fila, para que quepa sin barra de
  desplazamiento en un portátil de 768 px de alto.

Comprobación del problema que motivó el cambio: test con dos jugadores que van siempre a por su
estrella más cercana durante 20 partidas; con 3 estrellas el reparto queda por encima de 0,75
(el que menos coge / el que más).

Bots con las reglas nuevas (los pesos del segundo entrenamiento, medidos otra vez en test con 3
estrellas; todos puntúan más porque hay más que coger):

| nivel   | puntos (1 estrella) | puntos (3 estrellas) | segundos |
|---------|--------------------:|---------------------:|---------:|
| Fácil   |                2768 |                 3285 |     21,8 |
| Normal  |                6199 |                 8015 |     33,9 |
| Difícil |                8413 |                11039 |     44,3 |
| Experto |               11829 |                15137 |     54,9 |

Pruebas: 56 tests de Node; en navegador, un jugador (con vidas y dificultad elegidas en el menú),
dos pestañas y sala llena de 6.

Después, a petición del usuario: las vidas del marcador se dibujan como corazones (las perdidas,
apagadas) en vez de barritas.

Para que tras publicar el navegador no mezcle ficheros nuevos con viejos de su caché, las URLs de
scripts y estilos llevan un sufijo de versión (`?v=8`) que hay que subir en cada publicación.

### Tercer entrenamiento (`tres`): resultado negativo

Pregunta: ¿un bot criado desde cero con las reglas nuevas (3 estrellas y partidas repartidas entre
las tres dificultades, la mitad en normal) mejora al del segundo entrenamiento, que solo las ha
heredado? Mismo algoritmo, misma red, misma semilla, 300 generaciones.

La fitness sube igual que en los anteriores (`train/results/tres.csv`):

| gen | media población | validación (puntos) | validación (s) |
|----:|----------------:|--------------------:|---------------:|
|   0 |            1158 |                1401 |           15,1 |
|  50 |            9169 |                9939 |           30,2 |
| 100 |           11348 |               10553 |           36,9 |
| 150 |           12821 |               12645 |           44,8 |
| 200 |           13441 |               13171 |           49,5 |
| 299 |           14215 |               14839 |           56,1 |

Pero en las mismas 60 partidas de test, con las reglas nuevas, queda por debajo del anterior en
las tres dificultades:

| proyectiles | segundo entrenamiento (`tca`) | tercero (`tres`) |
|-------------|------------------------------:|-----------------:|
| suaves      |              19088 pts, 68,9 s |  18110 pts, 66,4 s |
| normales    |              15675 pts, 58,1 s |  13440 pts, 50,3 s |
| intensos    |              12257 pts, 46,2 s |  11385 pts, 43,6 s |

**No se integra: el juego sigue con los pesos del segundo entrenamiento.** Lectura prudente: es
un solo entrenamiento de cada tipo, y la diferencia (un 5-15 %) puede ser azar de la evolución.
Para afirmar que mezclar dificultades perjudica harían falta varias repeticiones con semillas
distintas. Lo que sí se puede decir es que el bot anterior generaliza bien a las reglas nuevas sin
haberlas visto: los sensores le describen la estrella más cercana y el momento del impacto, y eso
no cambia con el número de estrellas ni con la velocidad.

Referencias con las reglas nuevas (60 partidas de test): quieto 817 puntos y 13,6 s; aleatorio
1375 y 20,3 s; planificador con 250 ms de reacción 4586 y 33,9 s; planificador perfecto 17888 y
202,7 s.

Verificado en la URL pública tras publicar: sirve la versión nueva y la prueba de dos pestañas
(crear sala, unirse, jugar dos rondas, caída del anfitrión) pasa.

Pendiente: los datos de un humano jugando en solitario, y probar entre redes distintas y en móvil.

## Iteración 7 — Registro de partidas, estrellas lejos de los jugadores y bots que compiten (2026-10-10)

**Primer dato de un humano.** El usuario: 7032 puntos contra 1 bot Difícil, con 3 vidas y
proyectiles intensos. Como referencia, dos bots Difícil (los de entonces) jugando entre sí con
esos ajustes hacen de media 6062 puntos y 32,3 s. Es una sola partida y no es la configuración de
referencia, así que no da para concluir nada, pero el humano queda por encima de la media del bot
al que se enfrentaba. Desde esta versión el juego guarda todas las partidas con sus ajustes, así
que la comparación se podrá hacer con muchas.

Peticiones del usuario:
1. Un registro de sus partidas con puntos, ajustes y medias, con filtros por tipo, y los récords
   de cada modo arriba.
2. Que las estrellas no aparezcan encima ni muy cerca de los jugadores, y con muchos jugadores,
   algo más separadas.
3. Entrenar a un bot con otros bots, y que vaya a la estrella más cercana salvo que un rival esté
   más cerca y vaya a cogerla: entonces, a otra.

### 1. Mis partidas

- `js/stats.js` (sin DOM, con tests): cada partida terminada se guarda en el navegador con fecha,
  puntos, tiempo, estrellas, puesto y sus ajustes (local o sala, jugadores, bots y su nivel, vidas,
  proyectiles). Tope de 1000 partidas. Recupera el historial y los récords de versiones anteriores.
- Pantalla "Mis partidas": arriba, una fila por modo jugado con récord, media, partidas y ganadas;
  al pulsar una fila los filtros se ponen en ese modo. Debajo, filtros (dónde, bots, nivel, vidas,
  proyectiles), el resumen de lo filtrado y la lista. "Borrar registro" pide confirmación.
- En el menú se ve el récord y la media con los ajustes elegidos en ese momento, y al acabar cada
  partida, si es récord del modo.
- Un "modo" es la combinación exacta de ajustes; en sala cuenta también cuántos humanos había.
- La partida de 7032 puntos no está en el registro: la versión anterior solo guardaba las partidas
  en solitario.

### 2. Estrellas lejos de los jugadores

Una estrella aparece a más de 110 px de cualquier jugador en pie, más 10 px por cada jugador
adicional (160 px con 6), además de las reglas que ya había (180 px de quien la cogió, 140 px de
las otras). Se prueban hasta 16 sitios; si la arena está tan llena que ninguno cumple todo, se
queda el que más se acerca. En partidas simuladas con 1, 2, 4 y 6 jugadores persiguiendo
estrellas, más del 97 % aparecen a la distancia pedida y ninguna a menos del 60 % de ella (hay test).

### 3. Bots que compiten por las estrellas

Primero comprobé si la idea servía antes de entrenar nada. El bot elige estrella con un coste:

    coste = mi distancia + A x (ventaja del rival que va hacia ella) + B x (ventaja de cualquier rival)

y va a la de menor coste ("ventaja" = cuántos px está ese rival más cerca que yo; "va hacia ella"
se mide con la dirección en la que se mueve). Con A = B = 0 es la más cercana, como antes. Con los
mismos pesos de red, dos bots con criterio contra dos sin él, 80 partidas:

| criterio (A, B) | con criterio | sin criterio | ganan los que tienen criterio |
|-----------------|-------------:|-------------:|------------------------------:|
| (1, 0)          |        11638 |        10951 |                          70 % |
| (2, 0)          |        12764 |        11081 |                          78 % |
| (4, 0)          |        12950 |        10997 |                          85 % |
| (4, 2)          |        13423 |        11371 |                          84 % |

La idea del usuario funciona, y mucho. En vez de fijar A y B a mano, pasan a formar parte del
genoma (424 números: 422 de la red + 2) y los ajusta la evolución.

Entrenamiento en arena (`train/evolve-arena.js`): población de 64 que parte de los bots
publicados (no de redes al azar), con criterios iniciales variados; en cada generación cada
individuo juega 8 partidas de 4 contra otros tres de la población sorteados; fitness = sus puntos.
200 generaciones, unos 18 minutos. Métricas (`train/results/arena.csv`); "campeón contra 3" son
16 partidas fijas del campeón de esa generación contra tres bots de los de antes:

| gen | media población | campeón contra 3: puntos | los 3: puntos | gana | criterio medio (A, B) |
|----:|----------------:|-------------------------:|--------------:|-----:|-----------------------|
|   0 |           12522 |                    13521 |         11605 | 56 % | (1,69, 0,73)          |
|  50 |           13377 |                    14109 |         11910 | 63 % | (3,96, 1,79)          |
| 100 |           13770 |                    15095 |         11328 | 81 % | (5,38, 3,62)          |
| 150 |           14365 |                    15639 |         11009 | 88 % | (7,61, 4,09)          |
| 199 |           14589 |                    15136 |         12067 | 63 % | (8,90, 2,70)          |

La evolución empuja el criterio hacia arriba sin parar: empezó en torno a (1,7, 0,7) y acabó en
torno a (9, 3). Es decir, "si un rival va hacia ella y está más cerca, dala por perdida" resulta
ser todavía más rentable de lo que yo había probado a mano.

Resultado en test (80 partidas de 4, dos contra dos, sin tiempo de reacción):

| quién contra los bots anteriores            | puntos         | rondas ganadas |
|---------------------------------------------|----------------|---------------:|
| campeones de arena (red nueva + criterio)   | 14688 vs 11269 |           96 % |
| solo el criterio (red anterior + criterio)  | 13239 vs 11843 |           81 % |
| solo la red nueva (criterio a 0)            | 11581 vs 10589 |           69 % |

Jugando solo, el campeón de arena también mejora un poco: 16447 puntos frente a 15636.
**Integrado**: Difícil y Experto son ahora el campeón de arena (criterio 6,90 / 5,04).
Fácil y Normal siguen yendo a la más cercana: es parte de lo que los hace más fáciles.

Niveles nuevos (jugando solos, reglas de referencia): Fácil 3282, Normal 7757, Difícil 10982,
Experto 16582 puntos.

Límites de lo hecho:
- Qué estrella elegir no lo aprende la red: es una regla con dos números ajustados por evolución.
  Dársela a la red como entradas (las tres estrellas y la ventaja de cada rival) sería "más
  aprendido", pero una red de 12 neuronas difícilmente aprende a elegir entre direcciones, y esto
  funciona. La red sí se ha reentrenado jugando contra otros.
- El bot predice al rival por su dirección actual, nada más. Un humano que amaga lo engaña.
- Se ha entrenado y medido con 4 bots; con 2 o con 6 no está medido.

### Un fallo que casi se cuela

Al pasar el genoma de 422 a 424 números, el juego rechazaba el `weights.json` publicado y se
quedaba sin bots, en silencio. La prueba de navegador no lo detectó porque se saltaba la parte de
bots si no había niveles. Corregido: el juego acepta los dos formatos, y la prueba falla si hay
`weights.json` y no se carga ningún nivel.

Pruebas: 69 tests de Node (7 nuevos del registro, y los de colocación de estrellas y elección de
estrella); en navegador, un jugador (incluye el registro y sus filtros), dos pestañas y sala llena.


## Plan del bucle autónomo (2026-10-10, el usuario no está)

Encargo: hacer todos los puntos que propuse, añadir una dificultad "Imposible" para los
proyectiles, un bot "Modo Dios" lo más perfecto posible, elementos extra (mejoras de velocidad,
intangible y más) y entrenar a los bots para que los aprovechen. Orden y estado:

- [x] A. Simulación: dificultad Imposible, proyectiles nuevos (rebotan, ráfagas) y mejoras
      (turbo, fantasma, escudo, corazón, bomba, doble, imán), con red, dibujo, menú y registro.
- [x] B. Bots: sensores y genoma para las mejoras; entrenamiento en arena con 2, 4 y 6 jugadores;
      bot "Modo Dios" (planificador); niveles mezclados; nivel adaptativo.
- [x] C. Juego: pausa en local, repeticiones, exportar el registro, ayuda con las mejoras.
- [x] D. Robustez: retraso de red simulado en las pruebas de navegador; traspaso de anfitrión.
- [ ] E. Experimentos largos: repetir entrenamientos con varias semillas; que la red elija estrella;
      más proyectiles por sector para acercarse al techo.

Reglas que mantengo: solo esta carpeta, pruebas antes de cada publicación, y cada iteración queda
apuntada aquí debajo.

## Iteración 8 — Mejoras, proyectiles nuevos, Imposible, pausa y ayuda (2026-10-10, bucle autónomo)

**Mejoras** (objetos que aparecen cada 8-13 s, lejos de los jugadores, y esperan 10 s):

| mejora   | efecto                                                    |
|----------|-----------------------------------------------------------|
| Turbo    | 45 % más de velocidad durante 6 s                         |
| Fantasma | intangible 4 s: los proyectiles te atraviesan             |
| Escudo   | absorbe el siguiente impacto (dura 12 s)                  |
| Corazón  | una vida más; con todas, 300 puntos. Solo sale si a alguien le falta una vida |
| Bomba    | destruye los proyectiles a menos de 230 px                |
| Doble    | puntos dobles durante 8 s (tiempo y estrellas)            |
| Imán     | las estrellas se cogen desde 120 px durante 8 s           |

Regla "Mejoras: sí/no" en el menú y en la sala; el registro de partidas las trata como modos
distintos. Con las mejoras activadas pasan a ser las reglas de referencia.

**Proyectiles nuevos**, todos rojos (rojo = peligro): los que **rebotan** en las paredes una o
dos veces (anillo blanco mientras les quedan rebotes) desde el segundo 12, y **ráfagas** de tres
en abanico (más oscuros) desde el 20.

**Dificultad Imposible**: velocidad x1,5 y ritmo x2,4.

Decisión de diseño que condicionó la elección: nada que cambie la velocidad de los proyectiles ya
lanzados (congelar, cámara lenta). El invitado dibuja los proyectiles adelantados porque sabe
exactamente por dónde irán; un rebote se puede predecir igual de bien, una cámara lenta no. Para
eso `Sim.hazardPos` da la posición futura exacta de cualquier proyectil, rebotes incluidos, y la
usan el dibujo del invitado y el bot planificador.

Red: protocolo 3 (la instantánea lleva mejoras, los cinco efectos de cada jugador y el tipo de
proyectil). La predicción del propio jugador tiene en cuenta el turbo (hay test).

Bots: 3 entradas nuevas (llevo turbo / soy intangible / llevo escudo) y, mientras es intangible,
deja de percibir los proyectiles como amenaza. El "genoma" pasa de 424 a 467 números: 458 de la
red + 2 del criterio de rivales + 7 con lo que el bot valora cada mejora (en px de desvío que
está dispuesto a hacer por ella). Los pesos ya publicados se convierten sin cambiar de conducta
(las entradas nuevas entran con peso 0), y hay un test que lo comprueba.

También: **pausa** con P en partidas locales y pantalla **"Cómo se juega"** con las mejoras.

## Iteración 9 — Modo Dios, niveles Mixto y Adaptativo, exportar y repeticiones

**Modo Dios** (`js/god.js`). No es una red: es un planificador. En cada decisión simula 40 ticks
de futuro para 81 secuencias (9 movimientos, y a los 12 ticks otros 9), con la posición exacta de
cada proyectil, y elige la de menor coste (impactos, holgura, paredes y distancia al objetivo).
Elige objetivo igual que los bots de red: estrellas y mejoras con su valor, descartando lo que un
rival va a coger antes. Cuesta unos 0,6 ms por decisión.

Un defecto que destaparon los tests: "procrastinaba". Como le valía cualquier ruta que llegase a
la estrella dentro del horizonte, a menudo elegía quedarse quieto un rato antes de ir (17
estrellas en el primer minuto, cuando la red Experto coge unas 40). Cambiado el coste a "suma de
distancias al objetivo hasta que lo coge", que premia llegar antes:

| versión                              | puntos | aguanta | estrellas |
|--------------------------------------|-------:|--------:|----------:|
| planificador antiguo (referencia)    |  16484 |   177 s |      19,6 |
| Modo Dios, primera versión           |  40549 |   214 s |      79,2 |
| Modo Dios, sin procrastinar          |  73188 |   219 s |     177,3 |

(En solitario, reglas de referencia, 8-12 partidas.) Lo de "perfecto" tiene un límite físico: a
partir de ~200 s los proyectiles no dejan hueco. En el primer minuto no pierde ninguna vida (test).

**Niveles nuevos** en el menú y en la sala: *Modo Dios*; *Mixto* (un bot de cada nivel, del más
difícil al más fácil); *Adaptativo* (el nivel que te toca según cómo te ha ido contra bots: sube
medio escalón por ronda ganada y baja un tercio por perdida).

**Exportar el registro** a CSV y **repetición** de la última ronda (anfitrión y partidas
locales): como la simulación es determinista, se graba la semilla, las reglas y lo que pulsó cada
jugador en cada tick, y se vuelve a simular. Se acelera con V. Hay un test que comprueba que la
repetición acaba exactamente igual que la ronda (con bots, una invitada con retraso y una
desconexión por medio).

## Iteración 10 — Relevo de anfitrión y un fallo serio que casi publico

**Relevo.** Si se va quien creó la sala, el primer invitado de la lista la reabre y los demás le
siguen solos. La sala tiene código y "generación"; el identificador del anfitrión se deriva de
ambos, así que nadie tiene que avisar a nadie de dónde está el nuevo. Quien entra más tarde con
el código de siempre encuentra la generación viva. La ronda en curso se pierde y las victorias se
ponen a cero: lo que se conserva es la sala.

Tres fallos encontrados por las pruebas con pestañas reales, en orden:
1. Al cerrar, el anfitrión trataba el cierre de cada conexión como "se ha ido un jugador" y
   avisaba a los que quedaban con una lista falsa justo antes de desaparecer: dos invitados creían
   ser el primero. Corregido (al cerrar la sala no se procesan salidas), y además, si dos intentan
   tomar el relevo, el segundo sigue al primero en vez de rendirse.
2. **El serio.** De vez en cuando la invitada tomaba el relevo de una sala cuyo anfitrión seguía
   vivo. Diagnóstico con un muestreo de ambas pestañas: la del anfitrión se había quedado
   congelada 15 s (su temporizador corrió 3 veces en ese tiempo). Con la regla de entonces, 6 s de
   silencio bastaban para darlo por perdido. Antes eso solo acababa la partida; con el relevo
   partía la sala en dos. Cambiado el criterio: el silencio se avisa en pantalla a los 2,5 s, pero
   solo se da al anfitrión por perdido si la conexión se cierra de verdad (inmediato cuando cierra
   la pestaña) o tras 25 s de silencio. Al invitado silencioso se le espera 15 s en vez de 8.
   Test nuevo: anfitrión congelado 10 s, y al volver la sala sigue con todos dentro.
3. Mis propias pruebas de navegador tenían esperas cortas que fallaban con el portátil cargado
   (dos entrenamientos de fondo). Ampliadas.

No sé por qué se congela la pestaña en el Chrome de pruebas (sospecho de la carga del portátil con
los entrenamientos en marcha); en un navegador normal pasa al cambiar de pestaña o suspender el
equipo. En cualquier caso el juego tiene que aguantarlo, y ahora lo aguanta.

**Retraso de red simulado en navegador real**: `?lag=75&jitter=19` retrasa lo que envía esa
pestaña. `node test/browser/online.js --lag 75` comprueba, con PeerJS y WebRTC de verdad, que la
invitada se mueve al instante y que los proyectiles se adelantan lo que toca (~6 ticks con 150 ms
de ida y vuelta).

Pruebas a esta altura: 99 tests de Node; en navegador, un jugador (bots, Modo Dios en Imposible a
60 Hz, pausa, mixto, adaptativo, mejoras, ayuda, registro, repetición), dos pestañas con y sin
retraso, sala llena de 6 y relevo con tres pestañas. Las de dos pestañas fallan de vez en cuando
por congelaciones del propio Chrome de pruebas en afirmaciones de tiempo (1 de cada 5 con el
portátil cargado); el fallo del relevo indebido no ha vuelto a aparecer.

## Iteración 11 — Los bots aprenden las mejoras; Modo Dios ajustado (2026-10-10, bucle autónomo)

**Entrenamiento en arena con mejoras** (`arena2`, `train/results/arena2.csv`): población de 60
que parte de los bots publicados, con lo que vale cada mejora sorteado entre 0 y 300 px; mesas de
2, 4 y 6 bots (antes solo de 4); 250 generaciones. Tardó casi dos horas porque compartía el
portátil con el ajuste del Modo Dios y con mis pruebas de navegador.

Lo que la población valora de media cada mejora, en px de desvío que está dispuesta a hacer:

| gen | turbo | fantasma | escudo | corazón | bomba | doble | imán |
|----:|------:|---------:|-------:|--------:|------:|------:|-----:|
|   0 |   120 |      125 |    110 |     103 |    96 |   113 |  113 |
|  50 |   243 |      186 |    233 |     348 |    81 |   174 |  200 |
| 100 |   216 |      177 |    228 |     280 |    62 |   275 |  182 |
| 150 |   121 |      159 |    537 |     282 |    39 |   177 |   94 |
| 200 |   150 |      100 |    620 |     253 |    41 |   144 |  290 |
| 249 |    73 |      271 |    630 |     399 |    17 |   234 |  124 |

Partían todas iguales y la evolución las separó sola: el **escudo** es lo que más vale (un impacto
gratis), luego el **corazón**; el **turbo** y sobre todo la **bomba** acabaron casi ignorados. No
lo habría adivinado: yo habría puesto la bomba mucho más arriba. Tiene su lógica para un bot que
ya esquiva bien: la bomba le quita proyectiles que iba a esquivar igual, y el turbo le cambia los
tiempos de esquiva a los que está acostumbrado. El criterio de rivales siguió subiendo, de (8,5,
3,7) a (12,7, 9,2).

Resultado en test (80 partidas de 4 bots, dos contra dos, con mejoras):

| quién                        | contra quién                 | puntos         | rondas ganadas |
|------------------------------|------------------------------|----------------|---------------:|
| campeones nuevos (`arena2`)  | los publicados hasta ahora   | 14735 vs 12629 |           85 % |
| campeones nuevos             | los de la fase en solitario  | 14845 vs 10622 |           98 % |

**Integrado.** Niveles nuevos (jugando solos, reglas de referencia con mejoras): Fácil 3533,
Normal 7349, Difícil 10954, Experto 17197.

Ojo con la lectura: la validación por generación (16 partidas del campeón contra 3 publicados) fue
muy ruidosa, entre el 19 % y el 88 % de victorias sin tendencia clara, y la media de la población
subió poco (13582 -> 14592). Lo que da confianza es la medición final con 80 partidas, no la curva.

**Modo Dios ajustado** (`train/tune-god.js`, descenso coordenado sobre 5 parámetros, 10 partidas
por configuración): solo mejoraron dos cambios, objetivo 4 -> 8 y cambio de dirección a los 6
ticks en vez de 12; de 72365 a 75318 puntos en las partidas de ajuste. En test (20 partidas):

- solo: **72190 puntos, 211,5 s, 180 estrellas**;
- uno contra tres campeones de red: 23815 puntos frente a 13866, y **gana 20 de 20**.

Viaja en `weights.json` como un nivel más, con sus parámetros.

Pruebas: 99 tests de Node; navegador: un jugador, dos pestañas, sala llena y relevo, todas en verde.

### Punto de control (para retomar)

Hecho A, B, C y D del plan. Queda E (experimentos largos, todos opcionales y sin urgencia):
repetir entrenamientos con varias semillas para saber cuánto es azar; que la red elija objetivo en
vez de la regla; más de un proyectil por sector para acercar la red al planificador. Sin tareas
en segundo plano ahora mismo.


## Peticiones nuevas del usuario (2026-10-10, por la noche) y estado

Medición previa, a raíz de su pregunta "¿y si me quedo quieto y solo esquivo?": el mejor campero
posible (Modo Dios con estrellas y mejoras desactivadas) contra bots Experto, 30 partidas por fila:

| rivales   | gana el campero | es el último en pie | puntos campero / rival | aguanta campero / rival |
|-----------|----------------:|--------------------:|-----------------------:|------------------------:|
| 1 Experto |         0 de 30 |            30 de 30 |          3795 / 16796  |              61 / 61 s  |
| 3 Experto |         0 de 30 |            30 de 30 |          4608 / 15548  |              75 / 62 s  |
| 5 Experto |         0 de 30 |            30 de 30 |          4574 / 13114  |              75 / 61 s  |

Solo esquivar no gana nunca: una estrella vale 5 s de aguante y la ronda acaba en cuanto queda
uno, así que el superviviente no puede remontar. El problema real es el contrario (aguantar no
vale casi nada) y hay un hueco en la regla: con dos en pie, quien va ganando puede dejarse matar
para cerrar la ronda.

Pendiente de hacer:
- [ ] Estrellas de distinto valor, tamaño y color (más pequeña = más difícil = más puntos).
- [ ] Más enemigos con otras mecánicas y más daño, que aparezcan según la dificultad.
- [ ] Antídoto al juego pasivo / valor de aguantar: propuestas enviadas al usuario (tormenta,
      perder vida sin puntuar, racha, prórroga del último en pie, lluvia que busca al pasivo);
      espera su elección. Si no contesta: prórroga + racha, y tormenta como regla opcional.
- Pregunta sobre replicar agar.io con una skill "replica-skill": esa skill no está disponible en
  esta sesión; contestado. No se ha empezado nada.
