export const initialView = () => ({ phase: 'idle', note: '', position: null, requestId: null });

export function nextView(state, msg) {
  switch (msg.type) {
    case 'welcome': return { ...state, phase: 'idle', note: '' };
    case 'accepted': return { ...state, phase: 'queued', position: msg.position, requestId: msg.requestId };
    case 'status':
      return { ...state, phase: msg.state, note: msg.note, requestId: msg.requestId };
    case 'error': return { ...state, phase: 'error', note: msg.message || msg.code };
    default: return state;
  }
}

export function statusNote(state) {
  switch (state.phase) {
    case 'queued': return `In line${state.position ? ` (#${state.position})` : ''}…`;
    case 'building': return state.note || 'Building your effect…';
    case 'live': return state.note || "It's on the wall ✦";
    case 'failed': return state.note || "Couldn't build that — try rephrasing.";
    case 'error': return state.note || 'Something went wrong.';
    default: return '';
  }
}
