/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Cable, AlertTriangle, CheckCircle, Info, Zap, Cpu, Settings } from 'lucide-react';

export const HardwareGuideView: React.FC = () => {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Intro Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800/60 text-cyan-400">
            <Cable className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">3.5mm 音频孔硬件对录连接与电气规格指南</h2>
            <p className="text-xs text-slate-400">
              实现两台安卓手机之间通过 3.5mm 耳机孔进行模拟音频通信的物理层连线、阻抗匹配与防失真方案
            </p>
          </div>
        </div>
      </div>

      {/* Warning Box */}
      <div className="bg-amber-950/30 border border-amber-800/80 rounded-xl p-4 flex items-start gap-3 text-amber-200 text-xs leading-relaxed">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <b className="text-amber-300">核心避坑要点：</b>
          普通的 3.5mm 3节 (TRS) 双公头对录线两端均为“左声道、右声道、地”。如果直接将普通对录线插入两部手机的耳机孔，连接的是
          <b>【发送端 DAC 输出】与【接收端 DAC 输出】</b>，接收端的麦克风（ADC）根本没有接到信号！
          必须使用 <b>TRRS 分线器</b> 或 <b>交叉对录线</b> 将发送端的音频输出导向接收端的麦克风输入引脚。
        </div>
      </div>

      {/* Grid of Schematics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CTIA Pinout Diagram */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>3.5mm 4段 TRRS 接口引脚定义 (CTIA / 美标)</span>
            </h3>
            <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800">
              现代安卓主流标准
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3">
            {/* Visual Jack Graphic */}
            <div className="flex items-center justify-center py-4">
              <div className="flex items-center">
                {/* Plug Tip */}
                <div className="w-8 h-6 bg-cyan-500 rounded-l-md flex items-center justify-center text-[10px] font-bold text-slate-950" title="Tip: 左声道">
                  T
                </div>
                {/* Insulator */}
                <div className="w-1 h-6 bg-slate-800" />
                {/* Ring 1 */}
                <div className="w-8 h-6 bg-blue-500 flex items-center justify-center text-[10px] font-bold text-slate-950" title="Ring 1: 右声道">
                  R1
                </div>
                {/* Insulator */}
                <div className="w-1 h-6 bg-slate-800" />
                {/* Ring 2 */}
                <div className="w-8 h-6 bg-emerald-500 flex items-center justify-center text-[10px] font-bold text-slate-950" title="Ring 2: 地 GND">
                  R2
                </div>
                {/* Insulator */}
                <div className="w-1 h-6 bg-slate-800" />
                {/* Sleeve */}
                <div className="w-10 h-6 bg-amber-500 flex items-center justify-center text-[10px] font-bold text-slate-950" title="Sleeve: 麦克风输入">
                  S
                </div>
                {/* Base handle */}
                <div className="w-12 h-8 bg-slate-700 rounded-r-md flex items-center justify-center text-[10px] text-slate-300">
                  线柄
                </div>
              </div>
            </div>

            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="text-left py-1.5">段位</th>
                  <th className="text-left py-1.5">名称</th>
                  <th className="text-left py-1.5">CTIA (美标) 功能</th>
                  <th className="text-left py-1.5">OMTP (老国标)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900 text-slate-300">
                <tr>
                  <td className="py-1.5 font-bold text-cyan-400">Tip (尖端)</td>
                  <td className="py-1.5">左声道 (DAC Out)</td>
                  <td className="py-1.5 text-white">左声道输出</td>
                  <td className="py-1.5 text-slate-400">左声道输出</td>
                </tr>
                <tr>
                  <td className="py-1.5 font-bold text-blue-400">Ring 1 (中环1)</td>
                  <td className="py-1.5">右声道 (DAC Out)</td>
                  <td className="py-1.5 text-white">右声道输出</td>
                  <td className="py-1.5 text-slate-400">右声道输出</td>
                </tr>
                <tr>
                  <td className="py-1.5 font-bold text-emerald-400">Ring 2 (中环2)</td>
                  <td className="py-1.5">地线 (Ground)</td>
                  <td className="py-1.5 text-emerald-300 font-bold">模拟地线 (GND)</td>
                  <td className="py-1.5 text-amber-300">麦克风输入 (MIC)</td>
                </tr>
                <tr>
                  <td className="py-1.5 font-bold text-amber-400">Sleeve (根部)</td>
                  <td className="py-1.5">麦克风 (ADC In)</td>
                  <td className="py-1.5 text-amber-300 font-bold">麦克风输入 (MIC)</td>
                  <td className="py-1.5 text-emerald-300">模拟地线 (GND)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Recommended Connection Options */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>两种低成本物理连线方案</span>
            </h3>
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
              推荐方案
            </span>
          </div>

          {/* Scheme 1 */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
              <span>方案 A: 3.5mm 一分二 TRRS 音频+麦克风分离器 (最简便)</span>
            </div>
            <div className="text-xs text-slate-300 leading-relaxed font-mono">
              [手机 A 发送端] ──(3.5mm 对录线)──&gt; [手机 B 耳机孔上的 3.5mm Y型分线器之麦克风插孔 🎤]
            </div>
            <p className="text-[11px] text-slate-400 leading-normal">
              市售常见的“3.5mm 耳机/麦克风二合一转接线（带耳机图标和麦克风图标）”，内部已将 Sleeve 引脚引出为独立的 3.5mm 母座。将普通 3.5mm 双公头对录线一头插在手机 A，另一头插在手机 B 分线器的麦克风孔即可！
            </p>
          </div>

          {/* Scheme 2 */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
              <span>方案 B: 自制 3.5mm TRRS 交叉直通线 (硬件发烧友)</span>
            </div>
            <div className="text-xs text-slate-300 font-mono space-y-1">
              <div>端 A Tip (左声道DAC) ───────&gt; 端 B Sleeve (麦克风ADC)</div>
              <div>端 A Ring 2 (GND 地线) ──────&gt; 端 B Ring 2 (GND 地线)</div>
            </div>
            <p className="text-[11px] text-slate-400 leading-normal">
              无需额外分线头，自制一条 4 极耳机线直接交叉连接 Tip 与 Sleeve，形成单向高速数据通道。
            </p>
          </div>
        </div>
      </div>

      {/* Resistor Attenuator & Electrical Compatibility */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span>电气电平与分压衰减电路 (Resistor Attenuator & Impedance)</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="text-xs font-bold text-white">1. 电平差异 (Line vs Mic)</div>
            <p className="text-xs text-slate-400 leading-relaxed">
              发送端耳机输出为 <b>Line/Headphone 级别 (约 0.5V ~ 1.0V RMS)</b>；而安卓麦克风输入专为微弱语音设计，<b>灵敏度通常仅 10mV ~ 50mV RMS</b>。直接直通可能导致接收端削顶失真 (Clipping)。
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="text-xs font-bold text-cyan-300">2. 简易电阻分压网络</div>
            <p className="text-xs text-slate-400 leading-relaxed font-mono">
              DAC Out ──[ 10kΩ ]──┬──&gt; Mic In<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[ 1kΩ ]<br />
              GND ────────────────┴──&gt; GND
            </p>
            <p className="text-[11px] text-slate-500">
              提供约 20dB 线性衰减，彻底避免麦克风硬件前置放大器饱和。
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="text-xs font-bold text-emerald-300">3. 纯软件调试方案 (免烙铁)</div>
            <p className="text-xs text-slate-400 leading-relaxed">
              如果手头没有电阻元件：
              <br />• 将<b>发送端手机系统媒体音量调整至 50%~70%</b>；
              <br />• 在发送端页面滑动“输出电平幅度”滑块至 60%~75%；
              <br />• 观察接收端示波器，当 RMS 处于 <b>-18 dBFS ~ -6 dBFS</b> 时传输误码率最低。
            </p>
          </div>
        </div>
      </div>

      {/* Android Browser Quirks & Permissions */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
          <Settings className="w-4 h-4 text-cyan-400" />
          <span>安卓系统与移动浏览器关键配置建议</span>
        </h3>

        <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside leading-relaxed">
          <li>
            <b>HTTPS 安全协议限制：</b> 移动端 Chrome/Firefox 的 <code>navigator.mediaDevices.getUserMedia</code> 仅允许在 <b>HTTPS</b> 环境或 <b>localhost</b> 下访问麦克风。部署在 GitHub Pages (自带 HTTPS) 完全符合此规范。
          </li>
          <li>
            <b>关闭系统级音频增强：</b> 部分安卓手机（如小米的“米音”、三星的“杜比全景声”或华为的“Histen”）会自带 EQ 均衡器或人声增强算法，可能改变 FSK 1200Hz/2200Hz 的相对增益。建议在手机【设置 -&gt; 声音与振动 -&gt; 音效】中临时关闭杜比全景声。
          </li>
          <li>
            <b>耳机插入检测阻抗：</b> 某些机型检测到 Sleeve-to-Ground 悬空时可能认为没有外接麦克风，继续调用机身底部的物理麦克风。遇到此情况时，可插入分线器后再插线，或在麦克风引脚并联一个 2.2kΩ 假负载电阻。
          </li>
        </ul>
      </div>
    </div>
  );
};
