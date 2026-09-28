import { renderToStaticMarkup } from 'react-dom/server';
import type { Project } from '../model/types';
import { ChartSvg, type ChartSvgOptions } from './ChartSvg';
import { downloadBlob } from '../io/files';

export function chartSvgString(project: Project, opts: ChartSvgOptions = {}): string {
  const markup = renderToStaticMarkup(<ChartSvg project={project} {...opts} />);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
}

export function downloadSvg(project: Project, name: string, opts: ChartSvgOptions = {}): void {
  downloadBlob(name, new Blob([chartSvgString(project, opts)], { type: 'image/svg+xml;charset=utf-8' }));
}

/** SVG → PNG (고해상도 배율) */
export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 이미지를 불러오지 못했습니다'));
      img.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const maxSide = 16000;
    const s = Math.min(scale, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 생성 실패'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadPng(project: Project, name: string, opts: ChartSvgOptions = {}, scale = 2): Promise<void> {
  const blob = await svgToPngBlob(chartSvgString(project, opts), scale);
  downloadBlob(name, blob);
}

export async function copyPngToClipboard(project: Project, opts: ChartSvgOptions = {}): Promise<boolean> {
  const blob = await svgToPngBlob(chartSvgString(project, opts), 2);
  const CI = (window as unknown as { ClipboardItem?: new (items: Record<string, Blob>) => unknown }).ClipboardItem;
  if (!CI || !navigator.clipboard?.write) return false;
  await navigator.clipboard.write([new CI({ 'image/png': blob }) as ClipboardItem]);
  return true;
}
