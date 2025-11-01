$(document).ready(function() {
    $('a.abstract').click(function() {
        $(this).parent().parent().find(".abstract.hidden").toggleClass('open');
    });
    $('a.bibtex').click(function() {
        $(this).parent().parent().find(".bibtex.hidden").toggleClass('open');
    });
    $('.navbar-nav').find('a').removeClass('waves-effect waves-light');
});

// 自动更新页脚年份与日期，并保持居中
$(function() {
    var now = new Date();
    var year = now.getFullYear();
    var dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var footerContainer = document.querySelector('footer.fixed-bottom .container.mt-0');
    if (footerContainer) {
        footerContainer.style.textAlign = 'center';
        footerContainer.innerHTML = '&copy; Copyright ' + year + ' Yiren Zhao. Last updated: ' + dateStr + '.';
    }
});
