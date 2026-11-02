# Web UI

## Primitives

Controls come from [`components/ui`](../../apps/web/src/components/ui).
[AGENTS.md](../../AGENTS.md#taste) says how to use and extend them.

Don't style a raw `<button>`, `<input>`, `<select>`, or `<textarea>` to look like a control a
primitive provides. Raw elements are right when the element isn't that control: semantic rows, tabs,
resize handles, swatches, editor surfaces, anything whose behavior or geometry differs by design.

## Styles

Style with Tailwind classes in the component that renders the element.

- Global CSS, in [`index.css`](../../apps/web/src/index.css) or any other stylesheet, is only for
  what classes on the owning component can't express: imperative DOM, custom
  elements and shadow roots, animations, runtime theme variables, and browser or Electron
  integration.
- No `style={{ ... }}` or inline `<style>` for static values a class covers. Values computed at
  runtime are fine.
- Theme-only rules use `@variant dark` and `@variant light`, not `.dark` selectors.

## Composition

Compose or extend existing components instead of copying markup and classes. When
call sites repeat a treatment, put it in a variant or slot on the shared component.

## Handlers in large components

V8 gives every closure created in one render a single shared scope. A memoized handler keeps
the scope of the render that created it, and that scope holds the other memoized values of that
render. When handlers in one component change at different times, each keeps an older scope that
holds older handlers, and old renders, with their server configuration and application data, stay in memory
for as long as the component is mounted. React Compiler's memoized closures do the same.

In large, long-lived components, write handlers as plain
functions and wrap them with [`useStableCallback`](../../apps/web/src/hooks/useStableCallback.ts)
only where they leave the component: props, hook dependency arrays, and effect or memo bodies.
Calls inside the component keep the plain function, so work that resumes after an `await` still
acts on the render it started in. A function that a child calls during render, or after an
`await`, comes from a module-level factory memoized on its inputs, so its closure keeps only
those inputs.

## React Compiler

The compiler memoizes a component or hook only when it can prove the code follows React's rules.
Anything it can't prove, such as reading a ref during render or calling `setState` from an effect,
makes it skip the whole function without a build error. Lint reports each skip as a
`react(...)` warning with the note "React Compiler skipped optimizing this component or hook".

Every file under `apps/web/src` must compile. Lint makes those rules errors there, and
`madar/no-manual-memo` rejects `useMemo` and `useCallback`, which the compiler makes redundant;
no upstream rule bans them outright. It also rejects `"use memo"`. The compiler withholds a cache
scope when a value reaches plain function calls on both sides of a hook call. A `"use memo"`
helper forces one, but hides the ordering problem. Fix the order instead: plain uses of a value go
before the hook, or the helper is inlined. A `use*` helper that calls no hook is compiled as a
plain function and caches nothing, so a derived-value helper reads its source hook itself instead
of taking the value as an argument. `madar/no-hookless-use-function` rejects a `use*` function
that calls no hook. Lint misses some bailouts, notably `try` with `finally` and
`throw` inside `try`, so compiler coverage must include every source file. Async handlers rarely need `try`: an
atom command settles into a result, so cleanup can follow the `await`. `useStableCallback` still
marks handlers that leave a large component, as described above.
