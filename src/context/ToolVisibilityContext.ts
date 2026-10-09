import { createContext, useContext } from 'react';
import { isAdjustmentVisible, SectionVisibility } from '../utils/adjustments';

interface ToolVisibilityContextValue {
  onToggleVisibility(id: string): void;
  sectionVisibility: SectionVisibility;
}

export const ToolVisibilityContext = createContext<ToolVisibilityContextValue | null>(null);

export const useToolVisibility = (id: string) => {
  const context = useContext(ToolVisibilityContext);
  return (
    context && {
      isVisible: isAdjustmentVisible(context.sectionVisibility, id),
      toggle: () => context.onToggleVisibility(id),
    }
  );
};
