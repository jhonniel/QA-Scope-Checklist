import { useEffect, useLayoutEffect, useRef } from "react";
import type { Component } from "vue";
import { mountVueModule, type MountedVueModule } from "./mount";

export interface VueMountProps<P extends object> {
  component: Component;
  props: P;
  className?: string;
  /** Accessible role/label for the island container when it is a landmark. */
  ariaLabel?: string;
}

/**
 * React bridge for independently mounted Vue modules. Creates the Vue app on
 * mount, forwards prop changes, and tears down on unmount. Vue never renders
 * inside the React tree — it owns the DOM below this element.
 */
export function VueMount<P extends object>({ component, props, className, ariaLabel }: VueMountProps<P>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const moduleRef = useRef<MountedVueModule<P> | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    moduleRef.current = mountVueModule<P>(hostRef.current, component, latestProps.current);
    return () => {
      moduleRef.current?.unmount();
      moduleRef.current = null;
    };
  }, [component]);

  useEffect(() => {
    moduleRef.current?.update(props);
  }, [props]);

  return <div ref={hostRef} className={className} aria-label={ariaLabel} data-vue-module />;
}
