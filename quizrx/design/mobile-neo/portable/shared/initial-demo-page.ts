import type { Project } from './types.ts';

/** Picks useful first-run content without changing page order or empty-page data. */
export function initialDemoPageId(project: Pick<Project, 'pages'>): string {
  return project.pages.find(page => page.nodes.length > 0)?.id ?? project.pages[0]?.id ?? '';
}

/** Default navbar back target when a page has no explicit action. */
export function resolveDefaultBackTarget(project: Pick<Project, 'pages'>, currentPageId: string): string | undefined {
  const target = initialDemoPageId(project);
  return target && target !== currentPageId && project.pages.some(page => page.id === target) ? target : undefined;
}

/** Preserve an intentional page choice; otherwise avoid previewing an unchanged blank start page. */
export function proposalPreviewPageId(
  original: Pick<Project, 'pages'>,
  candidate: Pick<Project, 'pages'>,
  currentPageId: string | undefined,
  currentPageWasExplicitlySelected: boolean,
): string {
  const current = original.pages.find(page => page.id === currentPageId);
  const candidateKeepsCurrent = candidate.pages.some(page => page.id === currentPageId);
  if (candidateKeepsCurrent && (currentPageWasExplicitlySelected || (current && current.nodes.length > 0))) return currentPageId!;
  return initialDemoPageId(candidate);
}
