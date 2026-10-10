# LOG del experimento

Registro de decisiones, problemas, métricas y siguientes pasos. Lo más reciente va al final.

## Plan (2026-10-10)

**Juego: "Esquiva"** — arena cerrada vista desde arriba. Cada jugador es un círculo que se mueve en 8
direcciones. Desde los bordes entran proyectiles que cruzan la arena cada vez más rápido y más seguidos.
Cada jugador tiene 3 vidas; al recibir un impacto pierde una y queda invulnerable un instante. Hay una
estrella en la arena que da puntos al cogerla (obliga a moverse: no vale acampar en una esquina).
Gana la ronda el último que queda en pie; en solitario se juega a aguantar y puntuar.

Por qué este juego:
- Es puro reflejo, se entiende en 5 segundos y admite 2-6 jugadores sin cambiar reglas.
- Los jugadores no chocan entre sí, así que el retraso de red solo afecta a "yo contra los proyectiles".
- Los proyectiles van en línea recta: el cliente puede extrapolarlos y se ven fluidos aunque lleguen
  pocos paquetes por segundo.
- Es un buen problema para neuroevolución: entradas pequeñas, recompensa densa (tiempo vivo + estrellas).

**Arquitectura**
- `sim.js`: lógica pura, determinista (PRNG con semilla, paso fijo de 1/60 s), sin DOM. Se carga igual
  en Node y en el navegador.
- `nn.js`: red neuronal pequeña (percepción -> capa oculta tanh -> 2 salidas de movimiento) + sensores.
- `game.js` / `index.html`: dibujo en canvas, teclado/táctil, menús.
- `net.js`: salas con PeerJS. El anfitrión ejecuta `sim.js` y es la autoridad; los invitados envían
  sus teclas y reciben instantáneas. Predicción local del propio jugador para disimular el retraso.
- `train/`: neuroevolución en Node (población, torneo, mutación, elitismo). Exporta `weights.json`.
- `test/`: tests en Node con `node:test` (sin dependencias).

**Fases**
1. Prototipo de un jugador + simulación sin pantalla + tests.
2. Entrenamiento evolutivo, métricas por generación, comparación con humano.
3. Multijugador por salas con PeerJS, probado con dos pestañas.
4. Pulido, README y publicación en GitHub Pages (con confirmación).

**Límites conocidos (de diseño)**
- Pensado para ~6 jugadores: el anfitrión mantiene una conexión WebRTC con cada invitado.
- Si el anfitrión se cae o cierra la pestaña, la partida termina (no hay migración de anfitrión).
- El retraso de red se nota en un juego rápido: el anfitrión decide los impactos con la posición que
  él conoce, que va unas decenas de ms por detrás de lo que ve el invitado.
- Sin servidor propio: la señalización depende del servidor público gratuito de PeerJS y no hay TURN,
  así que algunas redes (NAT simétrico, redes corporativas, algunos móviles) pueden no conectar.

## Entorno e instalaciones

- Windows 10, i7-4700MQ, 8 GB RAM (~4 GB libres al empezar). git 2.55 ya estaba instalado.
- **Instalado: Node.js v24.21.0 LTS en modo portable** (zip oficial de nodejs.org, SHA256 verificado),
  en `.tools/node/` dentro de la carpeta del juego. No modifica PATH ni registro, no requiere
  administrador. Para desinstalar: borrar `.tools/`. Está excluido de git.
- Nada más instalado. Sin dependencias npm.
