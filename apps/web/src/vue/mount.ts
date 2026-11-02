import { createApp, h, reactive, type App, type Component } from "vue";

export interface MountedVueModule<P extends object> {
  update(props: Partial<P>): void;
  unmount(): void;
}

/**
 * Mount a Vue component as an independent island inside a DOM node.
 *
 * Props are held in a reactive object so React can push updates without
 * re-creating the Vue app. Event listeners are passed as `on*` props.
 */
export function mountVueModule<P extends object>(el: HTMLElement, component: Component, initialProps: P): MountedVueModule<P> {
  const state = reactive({ props: { ...initialProps } }) as { props: P };
  const app: App = createApp({
    name: "VueModuleHost",
    render: () => h(component, { ...state.props }),
  });
  app.mount(el);

  return {
    update(next) {
      state.props = { ...state.props, ...next };
    },
    unmount() {
      app.unmount();
    },
  };
}
