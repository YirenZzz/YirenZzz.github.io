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
$(function() {
    var year = new Date().getFullYear();
    var lastUpdatedStr = 'November 1, 2025';
    var footerContainer = document.querySelector('footer.fixed-bottom .container.mt-0');
    if (footerContainer) {
        footerContainer.style.textAlign = 'center';
        footerContainer.innerHTML = '&copy; Copyright ' + year + ' Yiren Zhao. Last updated: ' + lastUpdatedStr + '.';
    }
});
