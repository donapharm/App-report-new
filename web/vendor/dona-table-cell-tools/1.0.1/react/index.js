import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { mount } from '../src/core.js';

/**
 * Mounts the delegated controller on a React-owned container.
 * React may replace tbody/tr/td nodes freely; the controller remains mounted on the stable root.
 */
export function useDonaTableCellTools(options = {}) {
  const rootRef = useRef(null);
  const instanceRef = useRef(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!rootRef.current) return undefined;
    instanceRef.current = mount(rootRef.current, optionsRef.current);
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [options.appId, options.tableId]);

  return { rootRef, instanceRef };
}

/**
 * Optional wrapper. It renders only a div; React itself is a peer dependency of this subpath,
 * never of the core/IIFE bundle.
 */
export const DonaTableCellTools = forwardRef(function DonaTableCellTools(
  { as = 'div', options = {}, children, ...props }, forwardedRef
) {
  const { rootRef, instanceRef } = useDonaTableCellTools(options);
  useImperativeHandle(forwardedRef, () => ({
    get element() { return rootRef.current; },
    get instance() { return instanceRef.current; },
    open(cell) { return instanceRef.current?.open(cell) ?? false; },
    close(config) { return instanceRef.current?.close(config); },
    setLines(lines, persist) { return instanceRef.current?.setLines(lines, persist); }
  }), []);
  return React.createElement(as, { ...props, ref: rootRef }, children);
});

export default DonaTableCellTools;
