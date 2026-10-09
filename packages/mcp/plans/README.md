# Planes generados por `plan_task`

Esta carpeta guarda los checklists en markdown que produce la herramienta
`plan_task` y que consume `plan_execute`.

- `plan-<fecha>-<objetivo>.md` — un archivo por plan.
- Las casillas las marca `plan_mark_step`: `[x]` completado, `[!]` fallido con su
  error, `[ ]` pendiente.

Los planes se pueden editar a mano antes de ejecutarlos: el parser lee el
checklist del archivo, así que añadir, quitar o reordenar pasos funciona, siempre
que se mantenga el formato `- [ ] <número>. <acción>`.

Esta carpeta está en `.gitignore` salvo este README: los planes son trabajo en
curso del usuario, no parte del código.
