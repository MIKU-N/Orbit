import { FolderOpen, Info, LayoutGrid, LogOut, Plug, Settings, UserCog } from 'lucide-react';
import type { User } from '../types';
import { UserAvatar } from './UserAvatar';

export type SettingsTab = string;

interface AccountPopoverProps {
  open: boolean;
  user: User;
  version?: string;
  onClose: () => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onStartLayoutEdit: () => void;
  onLogout: () => void;
}

export function AccountPopover({
  open,
  user,
  version,
  onClose,
  onOpenSettings,
  onStartLayoutEdit,
  onLogout,
}: AccountPopoverProps) {
  if (!open) return null;

  return (
    <div
      id="accountPanel"
      onClick={(e) => e.stopPropagation()}
      className="fixed top-16 right-4 sm:right-6 z-40 w-56 max-w-[calc(100vw-2rem)] glass-strong rounded-2xl p-2.5 space-y-1 pop-in text-xs"
    >
      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenSettings('account');
        }}
        className="w-full flex items-center gap-2.5 px-2 py-2 border-b text-left orbit-hover rounded-t-xl cursor-pointer transition-colors"
        style={{ borderColor: 'var(--glass-border)' }}
        title="账号与头像"
      >
        <UserAvatar user={user} sizeClass="w-9 h-9" textClass="text-sm" />
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{user.username}</div>
          <div style={{ color: 'var(--ink-muted)' }}>
            {user.role === 'admin' ? '管理员' : '子账号'}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenSettings('appearance');
        }}
        className="w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 orbit-hover cursor-pointer text-left transition-colors"
      >
        <Settings className="w-4 h-4 opacity-80" />
        <span>系统设置</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenSettings('files');
        }}
        className="w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 orbit-hover cursor-pointer text-left transition-colors"
      >
        <FolderOpen className="w-4 h-4 opacity-80" />
        <span>文件管理</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenSettings('plugins');
        }}
        className="w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 orbit-hover cursor-pointer text-left transition-colors"
      >
        <Plug className="w-4 h-4 opacity-80" />
        <span>组件中心</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenSettings('account');
        }}
        className="w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 orbit-hover cursor-pointer text-left transition-colors"
      >
        <UserCog className="w-4 h-4 opacity-80" />
        <span>账号权限</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onStartLayoutEdit();
        }}
        className="hidden md:flex w-full px-2.5 py-2 rounded-xl items-center gap-2.5 orbit-hover cursor-pointer text-left transition-colors"
      >
        <LayoutGrid className="w-4 h-4 opacity-80" />
        <span>自由布局</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenSettings('about');
        }}
        className="w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 orbit-hover cursor-pointer text-left transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <Info className="w-4 h-4 opacity-80" />
          <span>关于</span>
        </span>
        {version && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            v{version}
          </span>
        )}
      </button>

      <div className="pt-1 border-t" style={{ borderColor: 'var(--glass-border)' }}>
        <button
          type="button"
          onClick={onLogout}
          className="w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 orbit-hover hover:text-red-400 cursor-pointer text-left transition-colors"
          style={{ color: 'var(--ink-muted)' }}
        >
          <LogOut className="w-4 h-4" />
          <span>退出登录</span>
        </button>
      </div>
    </div>
  );
}
