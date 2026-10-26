import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Nos tailles typographiques personnalisées (text-display, text-micro…) ne doivent pas
// être confondues avec les couleurs de texte (text-danger…) lors de la fusion des classes.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "title-1", "title-2", "title-3", "body", "caption", "micro"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
