import { useState } from 'react';
import { X } from 'lucide-react';
import { useOrbitHost } from '../../sdk/host';
import type { SettingsPanelProps } from '../../sdk/types';

export function BookmarksSettingsPanel({ highlightSection }: SettingsPanelProps) {
  const host = useOrbitHost();
  const { settings, updateSettings, bookmarkGroups: groups, createGroup, deleteGroup, importBrowserBookmarks, importSunPanel } = host;

  const [newGroupName, setNewGroupName] = useState('');
  const [browserHtml, setBrowserHtml] = useState('');
  const [browserGroupName, setBrowserGroupName] = useState('浏览器书签');
  const [importingBrowser, setImportingBrowser] = useState(false);
  const [sunPanelText, setSunPanelText] = useState('');
  const [showSunPanelImport, setShowSunPanelImport] = useState(false);

  const ownGroups = groups.filter((g) => !g.shared);

  const sectionHighlightStyle = (sectionId: string): React.CSSProperties =>
    highlightSection === sectionId
      ? {
          boxShadow: '0 0 0 2px var(--brand)',
          borderRadius: 'var(--radius-lg)',
          padding: '8px',
          transition: 'all 220ms ease',
        }
      : { transition: 'all 220ms ease' };

  return (
    <>
      <section data-section="sec-bm-view" style={sectionHighlightStyle('sec-bm-view')} className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm">书签展示风格与分组</span>
          <div className="flex rounded-lg p-0.5" style={{ background: 'var(--pill-bg)' }}>
            <button
              type="button"
              onClick={() => updateSettings({ dockStyle: 'card' })}
              className="px-2.5 py-1 rounded-md cursor-pointer"
              style={{
                background: settings.dockStyle === 'card' ? 'var(--brand-solid)' : 'transparent',
                color: settings.dockStyle === 'card' ? '#fff' : 'var(--ink-muted)',
              }}
            >
              卡片视图
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ dockStyle: 'icon' })}
              className="px-2.5 py-1 rounded-md cursor-pointer"
              style={{
                background: settings.dockStyle === 'icon' ? 'var(--brand-solid)' : 'transparent',
                color: settings.dockStyle === 'icon' ? '#fff' : 'var(--ink-muted)',
              }}
            >
              图标视图
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <div
              key={g.id}
              className="px-2.5 py-1 rounded-full flex items-center gap-1.5"
              style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
            >
              <span>{g.name}</span>
              {g.shared ? (
                <span style={{ color: 'var(--brand)' }}>(共享)</span>
              ) : (
                ownGroups.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void deleteGroup(g.id)}
                    className="opacity-60 hover:opacity-100 hover:text-red-400 cursor-pointer"
                    title="删除分组（该组书签同步删除）"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="新建书签分组名..."
            className="flex-1 h-8 px-2.5 rounded-lg focus:outline-none"
            style={{
              background: 'var(--pill-bg)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink)',
            }}
          />
          <button
            type="button"
            onClick={async () => {
              if (!newGroupName.trim()) return;
              await createGroup(newGroupName.trim());
              setNewGroupName('');
            }}
            className="px-3 h-8 rounded-lg cursor-pointer"
            style={{ background: 'var(--pill-hover)' }}
          >
            + 新建分组
          </button>
        </div>
      </section>

      <section
        data-section="sec-bm-import"
        style={{ ...sectionHighlightStyle('sec-bm-import'), borderColor: 'var(--glass-border)' }}
        className="space-y-3 pt-4 border-t"
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-medium text-sm">直接导入浏览器书签（默认归为一类）</span>
          <button
            type="button"
            onClick={() => setShowSunPanelImport((v) => !v)}
            className="px-2.5 py-1 rounded-lg cursor-pointer"
            style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
          >
            {showSunPanelImport ? '收起 Sun-Panel' : '或导入 Sun-Panel JSON'}
          </button>
        </div>

        <div className="p-3 rounded-xl space-y-2.5" style={{ background: 'var(--pill-bg)' }}>
          <div className="grid sm:grid-cols-3 gap-2 items-center">
            <span style={{ color: 'var(--ink-muted)' }}>导入归类分组名称</span>
            <input
              type="text"
              value={browserGroupName}
              onChange={(e) => setBrowserGroupName(e.target.value)}
              placeholder="浏览器书签"
              className="sm:col-span-2 h-8 px-2.5 rounded-lg focus:outline-none"
              style={{
                background: 'rgba(var(--glass-rgb), 0.5)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
          </div>
          <textarea
            rows={4}
            value={browserHtml}
            onChange={(e) => setBrowserHtml(e.target.value)}
            placeholder="支持 Chrome / Edge / Firefox / Safari 导出的书签 .html 文件内容..."
            className="w-full p-2.5 rounded-lg font-mono focus:outline-none resize-none"
            style={{
              background: 'rgba(var(--glass-rgb), 0.5)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink)',
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <label className="cursor-pointer hover:underline" style={{ color: 'var(--brand)' }}>
              选择浏览器书签 .html 文件
              <input
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void f.text().then(setBrowserHtml);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              disabled={importingBrowser || !browserHtml.trim()}
              onClick={async () => {
                setImportingBrowser(true);
                try {
                  await importBrowserBookmarks(
                    browserHtml,
                    browserGroupName.trim() || '浏览器书签',
                  );
                  setBrowserHtml('');
                } finally {
                  setImportingBrowser(false);
                }
              }}
              className="px-4 h-8 rounded-lg text-white font-medium cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--brand-solid)' }}
            >
              {importingBrowser ? '导入中...' : '一键导入为一类'}
            </button>
          </div>
        </div>

        {showSunPanelImport && (
          <div className="space-y-2 p-3 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
            <div className="font-medium">导入 Sun-Panel JSON</div>
            <textarea
              rows={4}
              value={sunPanelText}
              onChange={(e) => setSunPanelText(e.target.value)}
              placeholder="粘贴 Sun-Panel 导出的 JSON..."
              className="w-full p-2.5 rounded-lg font-mono focus:outline-none resize-none"
              style={{
                background: 'rgba(var(--glass-rgb), 0.5)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <button
              type="button"
              disabled={!sunPanelText.trim()}
              onClick={async () => {
                await importSunPanel(sunPanelText);
                setSunPanelText('');
                setShowSunPanelImport(false);
              }}
              className="px-4 h-8 rounded-lg text-white font-medium cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--brand-solid)' }}
            >
              执行 Sun-Panel 导入
            </button>
          </div>
        )}
      </section>
    </>
  );
}
