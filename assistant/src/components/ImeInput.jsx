import { useState, useRef, useEffect } from 'react';

/**
 * IME-safe input: defers onChange to after composition ends so
 * Chinese/Japanese/Korean input methods work correctly in React.
 */
export function ImeInput({ value, onChange, ...props }) {
  const [local, setLocal] = useState(value ?? '');
  const composing = useRef(false);

  useEffect(() => {
    if (!composing.current) setLocal(value ?? '');
  }, [value]);

  return (
    <input
      {...props}
      value={local}
      onChange={(e) => {
        setLocal(e.target.value);
        if (!composing.current) onChange(e);
      }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(e) => {
        composing.current = false;
        setLocal(e.target.value);
        onChange(e);
      }}
    />
  );
}

export function ImeTextarea({ value, onChange, ...props }) {
  const [local, setLocal] = useState(value ?? '');
  const composing = useRef(false);

  useEffect(() => {
    if (!composing.current) setLocal(value ?? '');
  }, [value]);

  return (
    <textarea
      {...props}
      value={local}
      onChange={(e) => {
        setLocal(e.target.value);
        if (!composing.current) onChange(e);
      }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(e) => {
        composing.current = false;
        setLocal(e.target.value);
        onChange(e);
      }}
    />
  );
}
