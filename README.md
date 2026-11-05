# Sistema de Inventario UPQ — versión nueva

Proyecto web local para administrar inventario, solicitudes, préstamos, devoluciones y adeudos.

## Contenido del inventario importado
Se importan automáticamente **655 registros** del archivo `InventarioLyTP2025 (1)(2).xlsx`:
- LT1: 316
- LT2: 155
- LT3: 115
- Edificio A – LT1: 32 (conserva la ubicación Edificio A – Laboratorio de Química)
- Edificio C: 37

En 31 registros de LT3 el Excel no tenía cantidad habilitada; se importan con cantidad 0 para no inventar existencias.

## Requisitos
- Windows 10/11
- Node.js LTS (npm incluido)
- Visual Studio Code recomendado

No requiere MySQL ni MySQL Workbench. Usa SQLite local (archivo `data/inventario.sqlite`).

## Ejecutar desde VS Code
1. Extrae el ZIP en una carpeta.
2. Abre esa carpeta directamente en VS Code. `package.json` debe verse en el nivel principal.
3. Abre Terminal → Nueva terminal.
4. Ejecuta:
   ```powershell
   npm install
   npm start
   ```
5. Abre http://localhost:3000

También puedes ejecutar `INICIAR.bat` desde el Explorador de Windows. Instala dependencias si faltan e inicia el servidor.

## Accesos iniciales
- Administrador: usuario `admin`, contraseña `Admin2026!`
- Alumnos/docentes: su matrícula como usuario, contraseña fija `UPQ22`.
- El administrador puede crear las cuentas y asignar nivel A, B, C o admin. Para crear cuentas, se requiere nombre y matrícula/usuario.
- Las cuentas con estatus `baja` no pueden iniciar sesión.

## Funciones
- Inventario con buscador, filtro por almacén, galería fotográfica de talleres y miniaturas ilustradas de herramientas, alta y baja de material.
- Solicitudes con varios materiales y validación de existencia.
- Aprobación/rechazo de solicitudes por admin o nivel A.
- Préstamos activos y buscador por nombre/matrícula.
- Devolución parcial o total con registro de condición; material dañado genera adeudo.
- Adeudos con estados pendiente, atrasado y entregado; al marcar reposición como entregada se suma la cantidad al inventario.
- Reportes con gráficas resumidas y exportación CSV.
- Administración de usuarios, niveles y estatus activo/baja.

## Integración con SII
La validación automática del SII no se activa porque no se proporcionó una API institucional ni credenciales autorizadas. Por ahora el administrador puede registrar el estado activo/baja de cada cuenta desde Usuarios y permisos. No se simula una conexión al SII.

## Datos
La base se crea automáticamente al primer arranque y carga `seed_inventory.sql` cuando el inventario está vacío. Los datos se guardan en `data/inventario.sqlite`. No borres esa carpeta si quieres conservar solicitudes, movimientos, usuarios y adeudos.

Para reiniciar todo desde cero, detén el servidor y elimina la carpeta `data`; al volver a iniciar se importa nuevamente el inventario inicial. Esto borra también los movimientos y usuarios creados localmente.

## Recursos visuales
La galería incluye imágenes ilustrativas de LT1, LT2, LT3, Química y Redes. Cada renglón del catálogo tiene una miniatura ilustrada genérica de herramienta; para fotografías específicas de los 655 artículos se necesitaría un catálogo fotográfico real de cada material.


## Catálogo visual completo
Se asignó una imagen única a cada uno de los 655 materiales del inventario. Se recuperaron 621 fotografías incrustadas en el Excel original y se generaron 34 ilustraciones individuales para los registros que no tenían una fotografía utilizable. Las 655 rutas son distintas y están incluidas localmente en `public/assets/materiales`; no dependen de internet.


## Acceso para alumnos y docentes
- Usuario compartido: `usuarioupq`
- Contraseña: `UPQ22`
- Administrador: `admin` / `Admin2026!`

Como los alumnos y docentes comparten una sola cuenta, al crear cada solicitud el sistema pide el nombre completo y la matrícula de la persona que solicita. Estos datos se guardan en el vale y se muestran en préstamos, devoluciones y adeudos para identificar correctamente a cada persona.


## Uso desde teléfonos y HTTPS
La interfaz se adapta a pantallas pequeñas: menú desplazable, formularios en una columna y tablas que se pueden deslizar horizontalmente.
Para que funcione con HTTPS y desde cualquier teléfono fuera de la red local, debe publicarse en un servicio de alojamiento. Se incluye `render.yaml` para desplegar en Render con disco persistente para conservar la base SQLite. Al publicar:
1. Sube esta carpeta a un repositorio privado de GitHub.
2. En Render, crea un servicio nuevo usando ese repositorio y el archivo `render.yaml` (Blueprint).
3. Espera a que termine el despliegue y abre la URL `https://...onrender.com` que Render asigna.
4. Comparte esa URL con los usuarios. Render proporciona el certificado HTTPS; el servidor redirige las visitas HTTP a HTTPS.
No publiques el repositorio como público si contiene datos reales. Cambia las contraseñas compartidas antes de usarlo con información institucional real. La cuenta compartida no identifica automáticamente a la persona que inició sesión: el solicitante debe capturar su nombre y matrícula en cada solicitud.


## Vistas según el nivel de acceso
- La cuenta compartida `usuarioupq` (Nivel C) muestra Resumen, Inventario y Solicitar herramienta. No muestra opciones administrativas ni listas de movimientos de otras personas.
- Las cuentas administrativas conservan Préstamos activos, Devoluciones, Adeudos, Reportes y Usuarios y permisos según su nivel.
- **Importante:** mientras alumnos y docentes compartan una sola cuenta, el sistema no puede identificar de forma segura quién consulta sus préstamos o adeudos. Por privacidad, la cuenta compartida no recibe esos listados. Para habilitar “Mis préstamos”, “Mis devoluciones” y “Mis adeudos” de forma privada, cada persona debe tener una identidad autenticada individual (por ejemplo, matrícula y contraseña propia).
