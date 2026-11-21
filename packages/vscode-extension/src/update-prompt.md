Actualiza MarIA Code a la última release de {{repo}}: la extensión de VS Code (instalada {{installedVersion}}, última {{latestVersion}}, tag {{tag}}) y el motor `omp`.

Release: {{releaseUrl}}
Lee sus notas (`gh release view {{tag}} --repo {{repo}}`, o la API de GitHub si no hay `gh`): dicen si el motor `omp` cambió o conserva el de una release anterior.

Entorno de la extensión:
- Sistema: {{platform}} ({{arch}}); editor: {{appName}}
- CLI del editor: `{{codeCli}}`
- Carpeta de la extensión instalada: `{{extensionPath}}`
- Almacenamiento global de la extensión: `{{globalStoragePath}}`. Si la ruta contiene `User/profiles/<id>`, la extensión está en un perfil de VS Code que no es el predeterminado: instala con `--profile <nombre>`, buscando el nombre de ese id en `User/globalStorage/storage.json` (`userDataProfiles`).

Pasos:
1. Extensión: descarga `maria-code.vsix` de la release e instálalo con `--install-extension <fichero> --force`. Comprueba después que la versión instalada es {{latestVersion}}.
2. Motor `omp`: averigua cómo está instalado (`omp --version`, ruta del ejecutable, y si es un binario de las releases, un checkout de este repositorio o un instalador de upstream).
   - Binario de las releases (`omp.exe` en Windows): descarga el de la release y reemplaza el ejecutable.
   - Checkout de este repositorio: pasa al tag y reconstruye como indica su README.
   - Instalador de upstream (Homebrew `can1357/tap/omp`, `omp.sh`, mise): no es esta distribución. No uses `omp update`, que resuelve contra el proyecto original. Dime cómo instalar el motor de esta release en mi sistema.
   - Si las notas dicen que el motor no cambió y ya tengo esa versión, no lo toques.

Reglas:
- Haz solo esto; no cambies nada más de mi configuración ni de mis proyectos.
- Si hace falta un permiso de administrador o no puedes saber cómo se instaló algo, para y pregúntame.
- Al terminar, resume las versiones de antes y de después, y dime que ejecute **Developer: Reload Window** para cargar la nueva extensión.
