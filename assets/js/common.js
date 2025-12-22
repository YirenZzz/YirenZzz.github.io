$(document).ready(function() {
    $('a.abstract').click(function() {
        $(this).parent().parent().find(".abstract.hidden").toggleClass('open');
    });
    $('a.bibtex').click(function() {
        $(this).parent().parent().find(".bibtex.hidden").toggleClass('open');
    });
    $('.navbar-nav').find('a').removeClass('waves-effect waves-light');
});

// 自动更新页脚年份，并使用网站实际更新时间（手动维护），保持居中
// $(function() {
//     var year = new Date().getFullYear();
//     var lastUpdatedStr = 'November 1, 2025';
//     var footerContainer = document.querySelector('footer.fixed-bottom .container.mt-0');
//     if (footerContainer) {
//         footerContainer.style.textAlign = 'center';
//         footerContainer.innerHTML = '&copy; Copyright ' + year + ' Yiren Zhao. Last updated: ' + lastUpdatedStr + '.';
//     }
// });

document.addEventListener('DOMContentLoaded', function () {
  var year = new Date().getFullYear();
  var lastUpdatedStr = 'November 1, 2025';

  // 1) 创建 footer
  var footer = document.createElement('footer');
  footer.className = 'fixed-bottom'; // 复用你原来的样式/位置

  // 2) 创建容器（用 bootstrap 的 container + 居中）
  var container = document.createElement('div');
  container.className = 'container mt-0 text-center';
  container.innerHTML =
    '&copy; Copyright ' + year + ' Yiren Zhao. Last updated: ' + lastUpdatedStr + '.';

  footer.appendChild(container);

  // 3) 插入到页面末尾
  document.body.appendChild(footer);

  // 4) 防止 footer 挡住内容（给 body 留出底部空间，按需要调大/调小）
  document.body.style.paddingBottom = '60px';
});
