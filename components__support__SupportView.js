import React from 'react';
import { Headphones, Send, Facebook, MessageCircle } from 'lucide-react';

const h = React.createElement;

const WhatsAppIcon = ({ className='' }) => h('svg',{viewBox:'0 0 24 24',fill:'currentColor',className,'aria-hidden':'true'},
  h('path',{d:'M20.5 3.5A11.8 11.8 0 0 0 12.1 0C5.6 0 .3 5.3.3 11.8c0 2.1.5 4.1 1.6 5.9L.2 24l6.5-1.7a11.8 11.8 0 0 0 5.4 1.4h.1c6.5 0 11.8-5.3 11.8-11.8 0-3.2-1.2-6.1-3.5-8.4Zm-8.3 18.2h-.1a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.8 1 1-3.7-.2-.4a9.8 9.8 0 1 1 8.5 4.7Zm5.4-7.3c-.3-.1-1.8-.9-2.1-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-1.7-.8-2.8-1.5-3.9-3.4-.3-.5.3-.5.8-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.2-1.2 2.9s1.2 3.3 1.4 3.5c.1.2 2.4 3.7 5.9 5.2.8.4 1.5.6 2 .7.8.3 1.6.2 2.2.1.7-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.3Z'})
);

const TelegramIcon = ({ className='' }) => h('svg',{viewBox:'0 0 24 24',fill:'currentColor',className,'aria-hidden':'true'},
  h('path',{d:'M21.9 2.4 18.6 21c-.2 1.3-1 1.6-2.1 1l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.2-8.3c.4-.4-.1-.6-.6-.2L5.7 14.7.8 13.2c-1.1-.3-1.1-1.1.2-1.6L20.2 4c.9-.3 1.9.2 1.7-1.6Z'})
);

const contacts = [
  { name:'واتساب', sub:'تواصل معنا مباشرة عبر الدردشة', href:'https://api.whatsapp.com/send?phone=970597603119', icon:WhatsAppIcon, wrap:'border-green-100 hover:border-green-400', box:'bg-green-50 text-green-500' },
  { name:'تليجرام', sub:'انضم للقناة أو راسلنا', href:'https://t.me/Oscar2teaam', icon:TelegramIcon, wrap:'border-sky-100 hover:border-sky-400', box:'bg-sky-50 text-sky-500' },
  { name:'فيسبوك', sub:'تابع صفحتنا وتواصل معنا', href:'https://www.facebook.com/share/1QcVmKWgpn/', icon:Facebook, wrap:'border-indigo-100 hover:border-indigo-400', box:'bg-indigo-50 text-indigo-600' },
];

export const SupportView = ({ embedded=false }) => h('div',{dir:'rtl',className:`w-full ${embedded?'p-3 sm:p-5':'p-4 sm:p-6'} flex justify-center`},
  h('section',{className:'w-full max-w-md overflow-hidden rounded-[28px] border border-slate-100 bg-white shadow-xl'},
    h('header',{className:'relative overflow-hidden bg-gradient-to-br from-violet-500 to-violet-800 px-6 py-8 text-center text-white'},
      h('span',{className:'absolute -right-12 -top-12 h-36 w-36 rounded-full bg-white/10 blur-2xl'}),
      h('span',{className:'absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-violet-200/10 blur-xl'}),
      h('div',{className:'relative mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl border border-white/20 bg-white/10 shadow-lg'},h(Headphones,{className:'h-9 w-9'})),
      h('h1',{className:'relative text-2xl font-black sm:text-3xl'},'فريق كاش توب 3 البرمجي'),
      h('p',{className:'relative mt-1 text-xs font-bold text-violet-100'},'مركز الدعم الفني والمساعدة')
    ),
    h('div',{className:'p-5 sm:p-6'},
      h('p',{className:'mb-6 text-center text-xs font-semibold leading-7 text-slate-500'},'أهلاً بك في مركز الدعم الفني. نحن هنا لمساعدتك والإجابة على استفساراتك. اختر وسيلة التواصل المناسبة:'),
      h('div',{className:'space-y-3'},...contacts.map(c=>h('a',{key:c.name,href:c.href,target:'_blank',rel:'noopener noreferrer',className:`flex items-center justify-between gap-3 rounded-2xl border-2 bg-white p-3.5 transition ${c.wrap}`},
        h('span',{className:'flex min-w-0 items-center gap-3'},
          h('span',{className:`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${c.box}`},h(c.icon,{className:'h-6 w-6'})),
          h('span',{className:'min-w-0 text-right'},h('b',{className:'block text-sm font-black text-slate-800'},c.name),h('small',{className:'mt-1 block text-[10px] font-bold text-slate-400'},c.sub))
        ),
        h(MessageCircle,{className:'h-4 w-4 shrink-0 text-slate-300'})
      )))
    ),
    h('footer',{className:'border-t border-slate-100 bg-slate-50 p-4 text-center text-[10px] font-bold text-slate-400'},'© 2026 جميع الحقوق محفوظة لـ CASH TOP 3')
  )
);
