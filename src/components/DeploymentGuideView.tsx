/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Download, ExternalLink, Github, Check, Copy, BookOpen, AlertCircle, Sparkles } from 'lucide-react';

export const DeploymentGuideView: React.FC = () => {
  const [copiedSender, setCopiedSender] = useState(false);
  const [copiedReceiver, setCopiedReceiver] = useState(false);

  const copyUrl = (path: string, setCopied: (v: boolean) => void) => {
    const full = window.location.origin + path;
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Intro */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800/60 text-cyan-400">
            <Github className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">GitHub Pages 部署与音频链路调试完整指南</h2>
            <p className="text-xs text-slate-400">
              单文件独立 HTML 部署至 GitHub Pages 的详细步骤，以及 3.5mm 音频物理链路标准化 5 步校准流程
            </p>
          </div>
        </div>
      </div>

      {/* Standalone HTML Downloads & Links Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center justify-between border-b border-slate-800 pb-2">
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>独立 HTML 网页直接访问与下载 (无需任何构建环境)</span>
          </span>
          <span className="text-[11px] font-mono text-emerald-400">零依赖 纯原生实现</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Sender */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-cyan-400">📡 发送端页面 (sender.html)</span>
              <span className="text-[10px] font-mono bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded border border-cyan-800">
                纯原生 HTML+JS
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              包含完整的 Web Audio CPFSK 调制器、Hamming(7,4) 编码器、CRC-16 校验码生成器、多包文件分卷切片引擎及示波器。
            </p>
            <div className="flex items-center gap-2 pt-1">
              <a
                href="/sender.html"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 px-3 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition"
              >
                <span>直接在新标签页打开</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => copyUrl('/sender.html', setCopiedSender)}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg flex items-center gap-1.5 transition cursor-pointer"
              >
                {copiedSender ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSender ? '已复制链接' : '复制直链'}</span>
              </button>
            </div>
          </div>

          {/* Receiver */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-emerald-400">📥 接收端页面 (receiver.html)</span>
              <span className="text-[10px] font-mono bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800">
                纯原生 HTML+JS
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              包含麦克风原生音频采集、时域波形示波器、频域 FFT 能量分布、正交匹配滤波解调器、Hamming(7,4) 纠错引擎及多包文件自动重组与下载器。
            </p>
            <div className="flex items-center gap-2 pt-1">
              <a
                href="/receiver.html"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition"
              >
                <span>直接在新标签页打开</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => copyUrl('/receiver.html', setCopiedReceiver)}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg flex items-center gap-1.5 transition cursor-pointer"
              >
                {copiedReceiver ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedReceiver ? '已复制链接' : '复制直链'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* GitHub Pages 部署步骤 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
          <BookOpen className="w-4 h-4 text-cyan-400" />
          <span>GitHub Pages 极速发布 3 步教程</span>
        </h3>

        <div className="space-y-4 text-xs">
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-400 flex items-center justify-center font-bold shrink-0">
              1
            </span>
            <div className="space-y-1">
              <div className="font-bold text-white text-sm">创建 GitHub 仓库并上传文件</div>
              <p className="text-slate-400 leading-relaxed">
                在 GitHub 新建一个仓库（例如命名为 <code>audiojack-fsk</code>，公开 Public）。将项目中的 <code>public/sender.html</code> 与 <code>public/receiver.html</code>（以及 <code>index.html</code>）上传至仓库的 <code>main</code> 分支根目录。
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-400 flex items-center justify-center font-bold shrink-0">
              2
            </span>
            <div className="space-y-1">
              <div className="font-bold text-white text-sm">开启 GitHub Pages 服务</div>
              <p className="text-slate-400 leading-relaxed">
                在仓库页面中，点击 <b>Settings (设置) -&gt; Pages</b>。在 <b>Branch (分支)</b> 下拉菜单中选择 <code>main</code> 分支与 <code>/ (root)</code> 目录，点击 <b>Save (保存)</b>。
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-400 flex items-center justify-center font-bold shrink-0">
              3
            </span>
            <div className="space-y-1">
              <div className="font-bold text-white text-sm">两台安卓手机分别访问</div>
              <p className="text-slate-400 leading-relaxed">
                等待 1 分钟后，GitHub Pages 会自动生成带有 HTTPS 证书的安全网址：
              </p>
              <div className="bg-slate-950 p-2.5 rounded font-mono text-cyan-300 space-y-1">
                <div>手机 A (发送端): https://&lt;你的用户名&gt;.github.io/audiojack-fsk/sender.html</div>
                <div>手机 B (接收端): https://&lt;你的用户名&gt;.github.io/audiojack-fsk/receiver.html</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5-Step Audio Link Calibration Guide */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
          <AlertCircle className="w-4 h-4 text-emerald-400" />
          <span>3.5mm 对录音频链路标准化 5 步校准流程 (Debug & Calibration)</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="font-bold text-cyan-400">第一步：线缆对插</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              手机 A 插耳机孔；手机 B 插 TRRS Y型分线器，对录线接在分线器的<b>麦克风孔</b>。
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="font-bold text-cyan-400">第二步：授权麦克风</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              手机 B 打开接收端，点击“启动监听”，在浏览器弹窗中点击“允许使用麦克风”。
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="font-bold text-cyan-400">第三步：校准音调平</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              手机 A 发送端点击“1200Hz 校准音”，调节 A 手机音量至接收端 RMS 显示在 -15 dBFS。
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="font-bold text-cyan-400">第四步：确认无削顶</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              确保接收端未出现红色的“CLIP 削顶”告警，且频谱图在 1200Hz 处有明显高耸尖峰。
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
            <div className="font-bold text-emerald-400">第五步：发送首包</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              在手机 A 点击“发送”，手机 B 即可在 1 秒内收到明文，CRC-16 绿灯亮起，纠错正常工作！
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
