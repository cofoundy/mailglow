# Components

Copy-paste blocks that survive Gmail, Outlook (Word engine), Apple Mail and Outlook.com. They assume the
classes from `templates/starter.html` (`ink`, `ink-2`, `ink-3`, `rule`, `bg-card`, `px`, `btn`) so dark
mode keeps working. Replace colours with the `EMAIL-BRAND.md` palette.

`FONT` below = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;`

## Button (bulletproof, with Outlook VML)

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn">
  <tr>
    <td align="center" bgcolor="#1c1b19" style="border-radius:10px;background-color:#1c1b19;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="https://example.com/x" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="20%" stroke="f" fillcolor="#1c1b19">
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">Open the conversation</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="https://example.com/x" target="_blank" style="display:inline-block;padding:14px 26px;FONT font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">Open the conversation</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>
```

The VML part is optional; without it Outlook desktop shows a square-cornered button that still works.

## Key / value rows

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="rule" style="border-top:1px solid #ecebe7;">
  <tr>
    <td class="ink-3" style="padding:12px 0 4px;FONT font-size:13px;line-height:20px;color:#8c897f;width:38%;vertical-align:top;">Contact</td>
    <td class="ink" style="padding:12px 0 4px;FONT font-size:14px;line-height:20px;color:#1c1b19;font-weight:600;">Jorge Huamán</td>
  </tr>
</table>
```

Most important value = boldest thing in its row. Labels muted, values ink.

## Stat tiles (stack on mobile)

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <th class="stack" width="33%" style="font-weight:normal;text-align:left;vertical-align:top;padding:0 6px 12px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="tile" style="background-color:#f4f3f0;border-radius:10px;padding:16px;FONT">
          <div class="ink" style="font-size:26px;line-height:30px;font-weight:700;color:#1c1b19;">128</div>
          <div class="ink-3" style="font-size:12px;line-height:16px;color:#8c897f;margin-top:4px;">conversations</div>
        </td>
      </tr></table>
    </th>
    <!-- repeat th ×2 -->
  </tr>
</table>
```

With `@media (max-width:620px){ .stack{display:block!important;width:100%!important;padding-right:0!important} }`
and `@media (prefers-color-scheme:dark){ .tile{background-color:#232322!important} }`.
`<th>` stacks where `<td>` won't in some Android clients.

## List row (a lead, an item, a notification)

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="rule" style="border-bottom:1px solid #ecebe7;">
  <tr>
    <td style="padding:16px 0;FONT">
      <div class="ink" style="font-size:15px;line-height:22px;font-weight:600;color:#1c1b19;">Jorge Huamán <span class="ink-3" style="font-weight:400;color:#8c897f;">· WhatsApp · 1h 35m</span></div>
      <div class="ink-2" style="font-size:14px;line-height:21px;color:#57534e;margin-top:2px;">Company event for 40 people, asks for menu and price per head.</div>
      <a href="https://app.example.com/inbox?c=con_1" style="display:inline-block;margin-top:8px;FONT font-size:14px;font-weight:600;color:#2f5bea;text-decoration:none;">Open conversation →</a>
    </td>
  </tr>
</table>
```

## Hosted image

```html
<img src="https://cdn.example.com/email/logo@2x.png" width="120" height="32" alt="Acme"
     style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:100%;">
```

- Always `width` attribute (Outlook), `alt` (images-off), `display:block` (no gap below).
- Export at 2× and set the display width. Keep a light-safe version: a logo on a transparent PNG that
  disappears on dark backgrounds needs a subtle outline or its own background tile.

## Divider

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td class="rule" style="border-top:1px solid #ecebe7;font-size:0;line-height:0;height:1px;">&nbsp;</td>
</tr></table>
```

## Spacer (Outlook ignores margin on many elements)

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td style="height:24px;font-size:0;line-height:0;">&nbsp;</td>
</tr></table>
```

## Footer

```html
<td class="px ink-3" style="padding:24px 40px 0;FONT font-size:12px;line-height:18px;color:#8c897f;">
  You get this because you're an admin of Picantería Doña Prudencia on Acme.
  <a href="https://app.example.com/settings/notifications" style="color:#8c897f;text-decoration:underline;">Notification settings</a><br>
  Acme Inc. · Lima, Perú
</td>
```

Operational alerts: reason + settings link, nothing else. Marketing: add unsubscribe (legally required).
