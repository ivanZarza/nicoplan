# 🏖️ NicoPlan — Documentación Técnica y de Usuario

**NicoPlan** es una aplicación web progresiva (PWA) de arquitectura *Serverless* diseñada específicamente para facilitar la organización de horarios y la coordinación de custodia compartida. 

Este documento explica **absolutamente todo** el funcionamiento interno, la estructura de datos, las tecnologías empleadas y las lógicas matemáticas aplicadas para el funcionamiento de la aplicación.

---

## 1. Arquitectura y Tecnologías (Stack Tecnológico)

El proyecto se ha construido bajo una premisa fundamental: **Mínimo mantenimiento, coste cero y máxima velocidad.** Por ello, prescinde de servidores tradicionales o bases de datos relacionales costosas.

### Tecnologías Frontend:
- **Vite:** Empaquetador de módulos ultrarrápido utilizado para compilar el código.
- **Vanilla JavaScript (ES6+):** Lógica pura sin frameworks pesados como React o Vue, asegurando que la carga inicial de la web sea casi instantánea, ideal para conexiones móviles 3G/4G.
- **CSS3 Moderno:** Uso de variables nativas de CSS (`:root`), Flexbox y CSS Grid. Todo es 100% Mobile-First y adaptativo.
- **Tesseract.js:** Motor de Inteligencia Artificial (OCR) que corre directamente en el navegador del usuario para interpretar texto dentro de imágenes, sin enviar las imágenes a ningún servidor externo.

### Tecnologías Backend (BaaS):
- **Firebase Realtime Database:** Base de datos NoSQL alojada en la nube (Región Europa) que sincroniza datos entre los dispositivos conectados en menos de un segundo usando WebSockets.
- **Firebase Storage:** Sistema de almacenamiento de archivos (tipo bucket S3) donde se guardan físicamente las capturas de pantalla de los horarios.

### Despliegue (CI/CD):
- **GitHub Actions:** Robot automatizado (`deploy.yml`) que lee cada cambio en el código fuente, lo compila construyendo la carpeta `/dist` y lo despliega automáticamente en la rama `gh-pages`.
- **GitHub Pages:** Alojamiento estático gratuito que sirve los archivos HTML/JS compilados al usuario final con certificados SSL de forma nativa.

---

## 2. Estructura y Flujo de la Aplicación

La aplicación es una "Single Page Application" (SPA). Nunca recarga la página; simplemente muestra u oculta las secciones manipulando el Document Object Model (DOM).

### 2.1 Módulo de Autenticación (`#login-view`)
- **Funcionamiento:** Un login ultra rápido basado en un PIN de 4 dígitos.
- **Persistencia:** Al iniciar sesión con un PIN válido, se guarda el usuario actual en el `sessionStorage` del navegador. Si cierras la pestaña, tendrás que volver a ponerlo, pero al navegar por la app no te lo volverá a pedir.
- **Credenciales:** (Definidas en `USERS` dentro de `main.js`).
  - Ivan: `1234`
  - Iria: `5678`

### 2.2 Módulo del Calendario Mensual (`#monthly-view`)
- **Renderizado Dinámico:** Calcula los días que tiene el mes en curso y genera una cuadrícula usando CSS Grid.
- **Indicadores visuales (Puntos):** Lee de Firebase qué turnos están asignados a ese día y pinta un pequeño punto (Azul para Ivan, Naranja para Iria).
- **Colores de Completitud (Traffic Light):**
  - *Transparente:* Día vacío.
  - *Amarillo:* `day-partial`. Al menos 1 turno asignado, pero faltan turnos.
  - *Verde:* `day-complete`. Todos los turnos requeridos están llenos (4 de lunes a viernes, 2 los fines de semana).
- **Interacción:** Al hacer clic en un día concreto, calcula a qué semana ISO pertenece ese día y abre automáticamente la vista semanal, filtrando los datos.

### 2.3 Módulo Semanal y Edición (`#weekly-view`)
- **Estructura de la Tabla:** Muestra de Lunes a Domingo.
  - *Lunes a Viernes:* Tienen habilitados los desplegables de "Llevar", "Recoger", "Tarde" y "Dormir".
  - *Sábados y Domingos:* Tienen habilitados únicamente "Día completo" y "Dormir". El resto se muestran como `—`.
- **Sincronización en vivo (CRUD):** 
  - Al cambiar un desplegable, se dispara un evento `change` que hace una llamada asíncrona `set(dbRef)` a Firebase.
  - Al estar escuchando toda la base de datos con `onValue()`, el cambio se refleja de vuelta instantáneamente en todos los móviles que tengan la app abierta.
- **Recuento Matemático:** Recorre los 7 días activos y cuenta cuántos strings de "ivan" y de "iria" existen, calculando el total y repintando las barras de porcentaje para visualizar la equidad del tiempo invertido.

### 2.4 Módulo de Horarios, OCR e Inteligencia (`#horarios-view`)
Esta es la parte más compleja. Consta de tres sub-sistemas:

#### A) Subida de Archivos a Storage
Cuando el usuario (Iria) selecciona una foto y pulsa "Subir Horario":
1. El archivo se convierte a Bytes y se envía a Firebase Storage.
2. Firebase Storage responde con una URL de descarga pública.
3. Esa URL, junto con los metadatos (fecha, subidoPor, horaEntrada, horaSalida), se guarda en Realtime Database bajo la rama `/horarios`.

#### B) Lector de Imágenes Inteligente (OCR - Tesseract.js)
1. Al seleccionar la imagen en el formulario, se invoca a Tesseract.js en segundo plano (Web Worker).
2. Analiza los píxeles intentando detectar texto en español (`spa`).
3. Se aplica una Expresión Regular (`/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g`) al texto extraído para cazar únicamente patrones de horas (por ejemplo: `08:00` o `15:30`).
4. Si encuentra dos o más horas, asume que la primera es la Entrada y la última detectada es la Salida, formateando y rellenando los campos visualmente como sugerencia.

#### C) Algoritmo de Auto-Asignación (`autoAsignarTurnos`)
Una vez confirmadas las horas, se disparan las reglas de negocio automáticas para rellenar la semana sin intervención humana:
- **Variable `Entrada`:**
  - Si `Entrada` < "09:00" → Iria está ocupada muy temprano. **Ivan** asume el turno de *Llevar*.
  - En caso contrario → Iria puede llevar a Nico. **Iria** asume el turno de *Llevar*.
- **Variable `Salida`:**
  - Si `Salida` > "14:00" → Iria sale de trabajar tarde y no llega a tiempo. **Ivan** asume el turno de *Recoger* y el de *Tarde*. **Iria** asume el turno de *Dormir*.
  - En caso contrario → Iria puede recogerle. **Iria** asume el turno de *Recoger*.

*Nota: Esta auto-asignación es puramente una "sugerencia rápida", ya que cualquier usuario puede ir a la vista semanal y reescribir manualmente el turno si las condiciones reales varían (ej. un atasco, un cambio de planes).*

---

## 3. Estructura de la Base de Datos (Firebase)

El modelo NoSQL de Firebase está diseñado en forma de árbol JSON para que el acceso a los datos de una semana concreta sea ultra rápido.

```json
{
  "horarios": {
    "2026-07-06": {
      "fecha": "2026-07-06",
      "fotoUrl": "https://firebasestorage.googleapis.com/v0/b/nicoplan-app.appspot.com/...",
      "horaEntrada": "05:00",
      "horaSalida": "14:00",
      "subidoPor": "iria",
      "timestamp": 1718978550123
    }
  },
  "semanas": {
    "2026-W28": {
      "dias": {
        "2026-07-06": {
          "llevar": "ivan",
          "recoger": "iria",
          "tarde": "ivan",
          "dormir": "iria"
        },
        "2026-07-11": {
          "dia": "ivan",
          "dormir": "iria"
        }
      }
    }
  }
}
```

---

## 4. Directorio y Archivos del Proyecto

El código fuente (`/home/ivan/dev/nicoplan`) está organizado de forma minimalista:

- `index.html`: Esqueleto visual de la app, importador del archivo JS y donde se instancian todos los `<div>` vacíos que Javascript rellenará.
- `vite.config.js`: Configuración vital. Define `base: '/nicoplan/'` para que, al compilar, todos los enlaces y scripts funcionen correctamente dentro de la subcarpeta del servidor de GitHub Pages.
- `src/firebase.js`: El puente de conexión. Contiene el secreto de la API, el AppID y la URL estricta de la base de datos europea para que el SDK de Firebase sepa a qué servidor mandar los datos.
- `src/style.css`: Estilos visuales. Define la paleta cromática (`--color-ivan` y `--color-iria`), las animaciones de botón (`hover`), y la cuadrícula CSS para asegurar que los calendarios no se salgan de las pantallas de teléfonos estrechos.
- `src/main.js`: El cerebro. Sus más de 300 líneas gestionan el enrutamiento de pestañas, el renderizado del calendario, la escucha de la base de datos `onValue()`, el cálculo ISO de las semanas, y la función OCR del Tesseract.

---

## 5. Mantenimiento y Futuras Actualizaciones

Si en el futuro se desea añadir una funcionalidad nueva (por ejemplo, añadir un turno de "Comida" los fines de semana), los pasos son:
1. Clonar el repositorio localmente.
2. Modificar el array de turnos dentro de la función `renderWeek` en `src/main.js`.
3. Hacer `git commit` y `git push`.
4. El robot de GitHub entrará en funcionamiento (descrito en `.github/workflows/deploy.yml`) y automáticamente sustituirá el servidor público con la nueva versión.
