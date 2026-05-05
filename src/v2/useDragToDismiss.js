// ============================================================
// useDragToDismiss — iOS-style drag-down-to-close hook (0.4.46)
// ============================================================
// Manuel pidió: "deberia poder hacer drag down menus para sacarlos
// de la pantalla". Sheets como SettingsSheet, EditProfileSheet,
// ChangelogSheet, etc. tenían el drag handle visual (la rayita
// gris arriba) pero no funcional — solo se cerraban con el botón
// X o tap-on-backdrop.
//
// HOW IT WORKS
//   const dtd = useDragToDismiss(onClose);
//   <div ref={dtd.ref} style={{ ...dtd.dragStyle }}>
//
//   - touchstart: snapshot startY + scrollTop del container
//   - touchmove: si scrollTop > 0 NO drageamos (es scroll real).
//     Si scrollTop === 0 y deltaY > 0, aplicamos translateY(deltaY)
//     y preventDefault() así el browser no se come el touch como scroll.
//   - touchend: si deltaY > THRESHOLD, llamamos onClose().
//     Si no, reseteamos translateY a 0 con transition smooth.
//
// IMPORTANT — non-passive listeners (0.4.48 fix)
//   La primera versión del hook usaba onTouchMove de React, que iOS
//   marca como passive listener. Con passive listener no podés
//   preventDefault() — el browser interpreta tu drag como scroll
//   vertical y nunca te entrega el touchmove. Resultado: el drag
//   se sentía como scroll bouncy y nunca disparaba el dismiss.
//
//   Solución: addEventListener directo con { passive: false } así
//   podemos preventDefault cuando estamos draggeando intencionalmente.
//   El scroll normal del container sigue funcionando porque solo
//   preventDefault'amos cuando dy > RESIST y scrollTop === 0.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";

const DISMISS_THRESHOLD = 120; // px — cuanto tiene que arrastrarse hacia abajo para cerrar
const RESIST_THRESHOLD = 6;    // px — debajo de esto ignoramos (evita micro-jitter)

/**
 * @param {() => void} onClose — callback que cierra la sheet
 * @param {object} opts
 * @param {boolean} [opts.disabled] — apaga el hook (ej cuando hay teclado virtual abierto)
 * @returns {{ ref, dragStyle, isDragging }}
 */
export function useDragToDismiss(onClose, opts = {}) {
  const { disabled = false } = opts;
  const ref = useRef(null);
  const startYRef = useRef(0);
  const startScrollRef = useRef(0);
  const draggingRef = useRef(false);
  const translateRef = useRef(0); // en sync con setTranslateY pero accesible synchronously
  const [translateY, setTranslateY] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  const setT = useCallback((v) => {
    translateRef.current = v;
    setTranslateY(v);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node || disabled) return;

    const handleTouchStart = (e) => {
      if (!e.touches || e.touches.length === 0) return;
      startYRef.current = e.touches[0].clientY;
      startScrollRef.current = node.scrollTop;
      draggingRef.current = false;
      setTransitioning(false);
    };

    const handleTouchMove = (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const dy = e.touches[0].clientY - startYRef.current;

      // Si el scroll del container no está en el top, dejamos que sea
      // scroll normal — no draggeamos. (scrollTop > 0 quiere decir que
      // ya bajaste algo de contenido y aún tenés más para arriba.)
      if (startScrollRef.current > 0) return;

      // Drag solo hacia abajo. Si va hacia arriba, NO arrastramos.
      if (dy <= RESIST_THRESHOLD) {
        if (draggingRef.current) {
          setT(0);
          draggingRef.current = false;
        }
        return;
      }

      // Estamos draggeando intencionalmente. preventDefault para que
      // el browser no robe el touch como scroll vertical.
      if (e.cancelable) e.preventDefault();
      draggingRef.current = true;
      setT(dy);
    };

    const handleTouchEnd = () => {
      if (!draggingRef.current) {
        setT(0);
        return;
      }
      draggingRef.current = false;
      const dy = translateRef.current;
      if (dy >= DISMISS_THRESHOLD) {
        // Animar fuera de pantalla y cerrar.
        setTransitioning(true);
        setT(window.innerHeight);
        setTimeout(() => {
          onClose && onClose();
        }, 220);
      } else {
        // Snap back al top.
        setTransitioning(true);
        setT(0);
      }
    };

    const handleTouchCancel = () => {
      draggingRef.current = false;
      setTransitioning(true);
      setT(0);
    };

    // passive: false en touchmove así podemos preventDefault.
    // touchstart y touchend pueden quedar passive (no llamamos
    // preventDefault ahí).
    node.addEventListener("touchstart", handleTouchStart, { passive: true });
    node.addEventListener("touchmove", handleTouchMove, { passive: false });
    node.addEventListener("touchend", handleTouchEnd, { passive: true });
    node.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [disabled, onClose, setT]);

  const dragStyle = {
    transform: translateY ? `translateY(${translateY}px)` : undefined,
    transition: transitioning ? "transform 220ms ease-out" : "none",
    touchAction: "pan-y",
  };

  return {
    ref,
    dragStyle,
    isDragging: translateY > 0,
    // dragHandlers es legacy; las sheets aplican {...dtd.dragHandlers}
    // pero ahora los listeners viven en useEffect. Devolvemos un objeto
    // vacío para no romper la API existente.
    dragHandlers: {},
  };
}
