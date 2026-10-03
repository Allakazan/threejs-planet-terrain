import { createContext, useContext } from 'react'
import { FloatingOrigin } from './FloatingOrigin'

/**
 * Module scope, not an effect: StrictMode double-mounts in dev and would hand
 * out two stores if this were created inside React.
 */
export const floatingOrigin = new FloatingOrigin()

/**
 * Exported as a bare context rather than a Provider component on purpose — a
 * file that exports a component must not also export hooks or constants under
 * `react-refresh/only-export-components`. Consumers render
 * `<OriginContext value={floatingOrigin}>` directly (React 19 shorthand).
 */
export const OriginContext = createContext<FloatingOrigin>(floatingOrigin)

export function useOrigin(): FloatingOrigin {
  return useContext(OriginContext)
}
