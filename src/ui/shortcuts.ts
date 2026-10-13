import { deleteSelection, duplicateSelection, rotateSelection, setTool } from '../core/actions';
import type { Store } from '../core/store';
import type { CanvasView } from '../render/canvasView';
import { saveJson } from '../io/files';
import { TOOLS_META } from '../tools/meta';
import type { ToolManager } from '../tools/toolManager';
import { isTyping } from './dom';

/** Raccourcis clavier globaux. */
export function installShortcuts(store: Store, tools: ToolManager, canvas: CanvasView): void {
  const toolByKey = new Map(TOOLS_META.flatMap((t) => (t.key ? [[t.key, t.id] as const] : [])));

  window.addEventListener('keydown', (e) => {
    const typing = isTyping();
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      store.redo();
      return;
    }
    if (typing) {
      if (e.key === 'Enter') (document.activeElement as HTMLElement).blur();
      return;
    }
    if (mod && key === 's') {
      e.preventDefault();
      saveJson(store.state.doc);
      return;
    }
    // Les raccourcis suivants sont propres au plan (le tableau a les siens).
    if (store.state.mode !== 'plan') return;
    if (e.code === 'Space') {
      e.preventDefault();
      canvas.setSpacePan(true);
      return;
    }
    if (mod && key === 'd') {
      e.preventDefault();
      duplicateSelection(store);
      return;
    }
    if (mod) return;

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        deleteSelection(store);
        return;
      case 'Enter':
        tools.active.finish();
        return;
      case 'Escape':
        if (tools.active.hasDraft()) tools.active.cancel();
        else if (store.state.tool !== 'select') setTool(store, 'select');
        else store.change((s) => (s.selection = null));
        return;
    }
    if (key === 'r') {
      rotateSelection(store);
      return;
    }
    const tool = toolByKey.get(key);
    if (tool) setTool(store, tool);
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') canvas.setSpacePan(false);
  });
}
