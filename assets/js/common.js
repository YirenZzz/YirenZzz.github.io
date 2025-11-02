$(document).ready(function() {
    $('a.abstract').click(function() {
        $(this).parent().parent().find(".abstract.hidden").toggleClass('open');
    });
    $('a.bibtex').click(function() {
        $(this).parent().parent().find(".bibtex.hidden").toggleClass('open');
    });
    $('.navbar-nav').find('a').removeClass('waves-effect waves-light');
});

// 自动更新页脚年份与网站最后更新时间，并保持居中
$(function() {
    var now = new Date();
    var rawLastUpdated = document.lastModified;
    var lastUpdatedDate = new Date(rawLastUpdated);
    if (isNaN(lastUpdatedDate.getTime())) {
        lastUpdatedDate = now;
    }
    var year = now.getFullYear();
    var lastUpdatedStr = lastUpdatedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var footerContainer = document.querySelector('footer.fixed-bottom .container.mt-0');
    if (footerContainer) {
        footerContainer.style.textAlign = 'center';
        footerContainer.innerHTML = '&copy; Copyright ' + year + ' Yiren Zhao. Last updated: ' + lastUpdatedStr + '.';
    }
});
